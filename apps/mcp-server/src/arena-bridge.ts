import {
  AgentIdentityStore,
  PlayerClient,
  type PlayerClientOptions,
  type TurnContext
} from "@llm-chess/player-sdk"
import {
  agentMetadataSchema,
  sessionIdSchema,
  type AgentMetadata,
  type Color,
  type MoveCommand,
  type ServerEvent,
  type SessionSnapshot
} from "@llm-chess/protocol"

interface ArenaPlayer {
  onEvent(handler: (event: ServerEvent) => void): void
  connect(): Promise<void>
  playMove(command: MoveCommand, expectedPly: number): void
  resign(): void
  close(): void
}

interface ConnectionState {
  client: ArenaPlayer
  server: string
  sessionId: string
  accepted?: Extract<ServerEvent, { type: "connection.accepted" }>
  snapshot?: SessionSnapshot
  turn?: TurnContext
  movePending: boolean
  lastError?: { code: string; message: string }
}

export interface JoinGameInput {
  server?: string
  sessionId: string
  name: string
  color?: Color
  agent: AgentMetadata
}

type PlayerFactory = (options: PlayerClientOptions) => ArenaPlayer
interface IdentityStore {
  getOrCreate(identity: { server: string; mode: string; name: string }): string
}

function normalizeServer(value: string): string {
  const endpoint = new URL(value)
  if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
    throw new Error("Arena server must use ws:// or wss://")
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Arena server URL must not contain credentials")
  }
  endpoint.pathname = ""
  endpoint.search = ""
  endpoint.hash = ""
  return endpoint.toString().replace(/\/$/, "")
}

function httpOrigin(server: string): string {
  return server.replace(/^ws/, "http")
}

function parsedSessionId(value: string): string {
  return sessionIdSchema.parse(value.toUpperCase())
}

export class ArenaBridge {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly defaultServer: string

  constructor(
    defaultServer = process.env.LLM_GAME_ARENA_SERVER ?? "ws://localhost:6464",
    private readonly request: typeof fetch = fetch,
    private readonly makePlayer: PlayerFactory = options => new PlayerClient(options),
    private readonly identities: IdentityStore = new AgentIdentityStore()
  ) {
    this.defaultServer = normalizeServer(defaultServer)
  }

  async createGame(server?: string): Promise<unknown> {
    return await this.requestJson(server, "/api/sessions", { method: "POST" })
  }

  async listGames(options: {
    server?: string
    status?: "waiting" | "ready" | "playing" | "finished"
    limit?: number
  }): Promise<unknown> {
    const query = new URLSearchParams({
      status: options.status ?? "finished",
      limit: String(options.limit ?? 20)
    })
    return await this.requestJson(options.server, `/api/sessions?${query}`)
  }

  async getGame(sessionId: string, server?: string): Promise<unknown> {
    return await this.requestJson(server, `/api/sessions/${parsedSessionId(sessionId)}`)
  }

  async startGame(sessionId: string, controllerToken: string, server?: string): Promise<unknown> {
    return await this.requestJson(server, `/api/sessions/${parsedSessionId(sessionId)}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${controllerToken}` }
    })
  }

  async leaderboard(options: {
    server?: string
    gameType?: string
    groupBy?: "identity" | "player" | "provider" | "model"
    limit?: number
  }): Promise<unknown> {
    const query = new URLSearchParams({
      gameType: options.gameType ?? "chess",
      groupBy: options.groupBy ?? "model",
      limit: String(options.limit ?? 20)
    })
    return await this.requestJson(options.server, `/api/leaderboard?${query}`)
  }

  async joinGame(input: JoinGameInput): Promise<unknown> {
    const server = this.server(input.server)
    const sessionId = parsedSessionId(input.sessionId)
    const key = this.connectionKey(server, sessionId)
    if (this.connections.has(key)) throw new Error("Player is already connected to this session")
    const agent = agentMetadataSchema.parse(input.agent)
    const identityToken = this.identities.getOrCreate({
      server,
      mode: `mcp:${agent.player}:${agent.provider}`,
      name: input.name
    })
    const client = this.makePlayer({
      server,
      sessionId,
      name: input.name,
      type: "agent",
      manual: true,
      identityToken,
      agent,
      ...(input.color ? { color: input.color } : {})
    })
    const state: ConnectionState = {
      client,
      server,
      sessionId,
      movePending: false
    }
    client.onEvent(event => this.handleEvent(state, event))
    this.connections.set(key, state)
    try {
      await client.connect()
    } catch (error) {
      this.connections.delete(key)
      client.close()
      throw error
    }
    return this.publicPlayerState(state)
  }

  async playerState(sessionId: string, server?: string): Promise<unknown> {
    const state = this.connection(sessionId, server)
    state.snapshot = await this.getGame(state.sessionId, state.server) as SessionSnapshot
    return this.publicPlayerState(state)
  }

  playMove(sessionId: string, command: MoveCommand, server?: string): unknown {
    const state = this.connection(sessionId, server)
    if (!state.turn) throw new Error("It is not this player's turn")
    if (state.movePending) throw new Error("A move is already pending confirmation")
    const uci = `${command.from}${command.to}${command.promotion ?? ""}`
    if (!state.turn.legalMoves.includes(uci)) {
      throw new Error(`Illegal move. Legal moves: ${state.turn.legalMoves.join(" ")}`)
    }
    state.movePending = true
    state.lastError = undefined
    state.client.playMove(command, state.turn.ply)
    return { submitted: uci, expectedPly: state.turn.ply }
  }

  resignGame(sessionId: string, server?: string): unknown {
    const state = this.connection(sessionId, server)
    state.client.resign()
    return { submitted: "resignation" }
  }

  disconnect(sessionId: string, server?: string): unknown {
    const state = this.connection(sessionId, server)
    state.client.close()
    this.connections.delete(this.connectionKey(state.server, state.sessionId))
    return { disconnected: true, sessionId: state.sessionId }
  }

  close(): void {
    for (const state of this.connections.values()) state.client.close()
    this.connections.clear()
  }

  private handleEvent(state: ConnectionState, event: ServerEvent): void {
    if (event.type === "connection.accepted") state.accepted = event
    if (event.type === "session.snapshot") state.snapshot = event
    if (event.type === "turn.started") {
      state.turn = event
      state.movePending = false
      state.lastError = undefined
    }
    if (event.type === "move.made" || event.type === "game.finished") {
      state.turn = undefined
      state.movePending = false
    }
    if (event.type === "move.invalid" || event.type === "error") {
      state.movePending = false
      state.lastError = { code: event.code, message: event.message }
    }
  }

  private publicPlayerState(state: ConnectionState): unknown {
    return {
      server: state.server,
      sessionId: state.sessionId,
      connected: Boolean(state.accepted),
      color: state.accepted?.color ?? null,
      movePending: state.movePending,
      turn: state.turn ?? null,
      lastError: state.lastError ?? null,
      snapshot: state.snapshot ?? null
    }
  }

  private connection(sessionId: string, server?: string): ConnectionState {
    const normalizedServer = this.server(server)
    const normalizedSessionId = parsedSessionId(sessionId)
    const state = this.connections.get(this.connectionKey(normalizedServer, normalizedSessionId))
    if (!state) throw new Error("No MCP player is connected to this session")
    return state
  }

  private connectionKey(server: string, sessionId: string): string {
    return `${server}|${sessionId}`
  }

  private server(value?: string): string {
    return value ? normalizeServer(value) : this.defaultServer
  }

  private async requestJson(
    server: string | undefined,
    path: string,
    init?: RequestInit
  ): Promise<unknown> {
    const response = await this.request(`${httpOrigin(this.server(server))}${path}`, init)
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
    if (!response.ok) {
      throw new Error(`${body.code ?? "REQUEST_FAILED"}: ${body.message ?? `HTTP ${response.status}`}`)
    }
    return body
  }
}
