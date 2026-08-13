/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers"
import { parseClientEvent, sessionIdSchema, type ServerEvent } from "@llm-chess/protocol"
import {
  ArenaService,
  type ConnectionBinding,
  type EventSink
} from "../../server/src/arena-service.js"
import { DomainError } from "../../server/src/domain.js"
import {
  SessionManager,
  type PersistedSession,
  type SessionRecord
} from "../../server/src/session-manager.js"

const SESSION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const MAX_MESSAGE_SIZE = 16 * 1024

interface Env {
  ASSETS: Fetcher
  DB: D1Database
  SESSIONS: DurableObjectNamespace<SessionDurableObject>
}

interface SocketAttachment {
  connectionId: string
  binding?: ConnectionBinding
}

interface SessionIndexRow {
  id: string
  game_type: string
  status: string
  white_name: string | null
  black_name: string | null
  winner: string | null
  finish_reason: string | null
  ply: number
  created_at: string
  updated_at: string
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return json({ code: error.code, message: error.message }, error.httpStatus)
  }
  return json({ code: "INTERNAL_ERROR", message: "Internal server error" }, 500)
}

function parseSessionId(value: string | undefined): string {
  const result = sessionIdSchema.safeParse(value?.toUpperCase())
  if (!result.success) {
    throw new DomainError(
      "INVALID_SESSION_ID",
      "Session ID must have 6 valid uppercase letters or numbers"
    )
  }
  return result.data
}

function makeSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, byte => SESSION_ALPHABET[byte % SESSION_ALPHABET.length]).join("")
}

function sessionStub(env: Env, sessionId: string): DurableObjectStub<SessionDurableObject> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(sessionId))
}

async function createSession(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionId = makeSessionId()
    const existing = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ id: string }>()
    if (existing) continue

    const response = await sessionStub(env, sessionId).fetch("https://session/initialize", {
      method: "POST",
      body: JSON.stringify({ sessionId })
    })
    if (response.ok) return response
  }
  return json({ code: "INTERNAL_ERROR", message: "Could not allocate a session ID" }, 500)
}

async function listSessions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const requestedStatus = url.searchParams.get("status")
  const status = requestedStatus === "waiting" || requestedStatus === "ready"
    || requestedStatus === "playing" || requestedStatus === "finished"
    ? requestedStatus
    : "finished"
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50)
  const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 50, 1), 100)
  const result = await env.DB.prepare(
    `SELECT id, game_type, status, white_name, black_name, winner, finish_reason,
      ply, created_at, updated_at
    FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?`
  ).bind(status, limit).all<SessionIndexRow>()
  return json({
    sessions: result.results.map(row => ({
      sessionId: row.id,
      gameType: row.game_type,
      status: row.status,
      whiteName: row.white_name,
      blackName: row.black_name,
      winner: row.winner,
      finishReason: row.finish_reason,
      ply: row.ply,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  })
}

async function routeApi(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (url.pathname === "/api/sessions" && request.method === "POST") {
    return await createSession(env)
  }
  if (url.pathname === "/api/sessions" && request.method === "GET") {
    return await listSessions(request, env)
  }

  const match = /^\/api\/sessions\/([^/]+)(\/start)?$/.exec(url.pathname)
  if (!match?.[1]) return undefined
  const sessionId = parseSessionId(match[1])
  const stub = sessionStub(env, sessionId)

  if (!match[2] && request.method === "GET") {
    return await stub.fetch("https://session/snapshot")
  }
  if (match[2] && request.method === "POST") {
    return await stub.fetch("https://session/start", {
      method: "POST",
      headers: { authorization: request.headers.get("authorization") ?? "" }
    })
  }
  return json({ code: "INVALID_MESSAGE", message: "Method not allowed" }, 405)
}

async function routeWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return json({ code: "INVALID_MESSAGE", message: "WebSocket upgrade required" }, 426)
  }
  const sessionId = parseSessionId(new URL(request.url).searchParams.get("session") ?? undefined)
  return await sessionStub(env, sessionId).fetch(new Request("https://session/ws", request))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === "/health") return json({ status: "ok" })
      if (url.pathname === "/ws") return await routeWebSocket(request, env)
      if (url.pathname.startsWith("/api/")) {
        return await routeApi(request, env)
          ?? json({ code: "SESSION_NOT_FOUND", message: "Route not found" }, 404)
      }
      return await env.ASSETS.fetch(request)
    } catch (error) {
      return errorResponse(error)
    }
  }
} satisfies ExportedHandler<Env>

export class SessionDurableObject extends DurableObject<Env> {
  private arena?: ArenaService
  private session?: SessionRecord
  private loadPromise?: Promise<void>

  constructor(
    private readonly context: DurableObjectState,
    env: Env
  ) {
    super(context, env)
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === "/initialize" && request.method === "POST") {
        const body = await request.json() as { sessionId?: string }
        return await this.initialize(parseSessionId(body.sessionId))
      }

      await this.ensureLoaded()
      if (!this.arena || !this.session) {
        throw new DomainError("SESSION_NOT_FOUND", "Session not found", 404)
      }

      if (url.pathname === "/snapshot" && request.method === "GET") {
        return json(this.arena.sessions.snapshot(this.session))
      }
      if (url.pathname === "/start" && request.method === "POST") {
        const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1]
        if (!token) throw new DomainError("UNAUTHORIZED", "Controller token is required", 401)
        this.arena.startSession(this.session.id, token)
        await this.persist()
        return json(this.arena.sessions.snapshot(this.session))
      }
      if (url.pathname === "/ws") return this.upgradeWebSocket(request)
      return json({ code: "SESSION_NOT_FOUND", message: "Route not found" }, 404)
    } catch (error) {
      return errorResponse(error)
    }
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoaded()
    if (!this.arena || !this.session) return
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (!attachment?.connectionId) {
      socket.close(1011, "Missing connection state")
      return
    }

    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message)
      if (raw.length > MAX_MESSAGE_SIZE) {
        throw new DomainError("INVALID_MESSAGE", "Message is too large")
      }
      const event = parseClientEvent(JSON.parse(raw) as unknown)
      if (event.type === "connection.join" && event.sessionId !== this.session.id) {
        throw new DomainError("SESSION_NOT_FOUND", "Session does not match this connection")
      }
      await this.arena.handleEvent(attachment.connectionId, event)
      socket.serializeAttachment({
        connectionId: attachment.connectionId,
        ...(this.arena.connectionBinding(attachment.connectionId)
          ? { binding: this.arena.connectionBinding(attachment.connectionId) }
          : {})
      } satisfies SocketAttachment)
      await this.persist()
    } catch (error) {
      const messageText = error instanceof SyntaxError ? "Message must be valid JSON" : "Invalid message"
      this.arena.sendError(
        attachment.connectionId,
        error instanceof DomainError ? error : new DomainError("INVALID_MESSAGE", messageText)
      )
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.removeSocket(socket)
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.removeSocket(socket)
  }

  private async initialize(sessionId: string): Promise<Response> {
    const existing = await this.context.storage.get<PersistedSession>("session")
    if (existing) {
      return json({ code: "INVALID_MESSAGE", message: "Session already exists" }, 409)
    }
    const manager = new SessionManager()
    this.session = manager.createSession(sessionId)
    this.arena = new ArenaService(manager)
    await this.persist()
    return json({
      sessionId: this.session.id,
      controllerToken: this.session.controllerToken
    }, 201)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.arena && this.session) return
    this.loadPromise ??= this.load()
    await this.loadPromise
  }

  private async load(): Promise<void> {
    const persisted = await this.context.storage.get<PersistedSession>("session")
    if (!persisted) return
    const manager = new SessionManager()
    this.session = manager.restore(persisted)
    this.arena = new ArenaService(manager)
    for (const socket of this.context.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.connectionId) continue
      this.arena.restoreConnection(
        attachment.connectionId,
        this.socketSink(socket),
        attachment.binding
      )
    }
  }

  private upgradeWebSocket(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || !this.arena) {
      return json({ code: "INVALID_MESSAGE", message: "WebSocket upgrade required" }, 426)
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const connectionId = `c_${crypto.randomUUID()}`
    server.serializeAttachment({ connectionId } satisfies SocketAttachment)
    this.context.acceptWebSocket(server)
    this.arena.addConnection(connectionId, this.socketSink(server))
    return new Response(null, { status: 101, webSocket: client })
  }

  private socketSink(socket: WebSocket): EventSink {
    return {
      send(event: ServerEvent) {
        socket.send(JSON.stringify(event))
      },
      close() {
        socket.close(1000, "Connection closed")
      }
    }
  }

  private async removeSocket(socket: WebSocket): Promise<void> {
    await this.ensureLoaded()
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (!attachment?.connectionId || !this.arena || !this.session) return
    this.arena.removeConnection(attachment.connectionId)
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (!this.arena || !this.session) return
    await this.context.storage.put("session", this.arena.sessions.persistable(this.session))
    const snapshot = this.arena.sessions.snapshot(this.session)
    await this.env.DB.prepare(
      `INSERT INTO sessions (
        id, game_type, status, white_name, black_name, winner, finish_reason, ply, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        white_name = excluded.white_name,
        black_name = excluded.black_name,
        winner = excluded.winner,
        finish_reason = excluded.finish_reason,
        ply = excluded.ply,
        updated_at = CURRENT_TIMESTAMP`
    ).bind(
      this.session.id,
      this.session.gameType,
      this.session.status,
      this.session.white?.name ?? null,
      this.session.black?.name ?? null,
      snapshot.game?.result?.winner ?? null,
      snapshot.game?.result?.reason ?? null,
      snapshot.game?.ply ?? 0
    ).run()
  }
}
