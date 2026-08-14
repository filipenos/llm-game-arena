import { randomUUID } from "node:crypto"
import type {
  ChessMove,
  AgentMetadata,
  Color,
  MoveCommand,
  ParticipantType,
  ServerEvent
} from "@llm-chess/protocol"
import { parseUci } from "@llm-chess/protocol"
import WebSocket from "ws"

export {
  AgentIdentityStore,
  defaultIdentityStoreDirectory,
  type AgentIdentity
} from "./identity-store.js"

export interface TurnContext {
  gameId: string
  fen: string
  color: Color
  ply: number
  lastMove?: ChessMove
  legalMoves: string[]
}

export interface PlayerClientOptions {
  server: string
  sessionId: string
  name: string
  type: ParticipantType
  color?: Color
  resumeToken?: string
  identityToken?: string
  agent?: AgentMetadata
  manual?: boolean
}

type TurnHandler = (context: TurnContext) => Promise<MoveCommand> | MoveCommand
type EventHandler = (event: ServerEvent) => void

export function playerWebSocketUrl(server: string, sessionId: string): URL {
  const endpoint = new URL(server)
  endpoint.pathname = "/ws"
  endpoint.searchParams.set("session", sessionId)
  return endpoint
}

export class PlayerClient {
  private socket?: WebSocket
  private turnHandler?: TurnHandler
  private eventHandler?: EventHandler
  private currentTurn?: string
  private accepted = false
  private resolveConnect?: () => void
  private rejectConnect?: (error: Error) => void

  constructor(private readonly options: PlayerClientOptions) {}

  onTurn(handler: TurnHandler): void {
    this.turnHandler = handler
  }

  onEvent(handler: EventHandler): void {
    this.eventHandler = handler
  }

  connect(): Promise<void> {
    if (this.socket) return Promise.reject(new Error("Player is already connected"))
    const endpoint = playerWebSocketUrl(this.options.server, this.options.sessionId)
    this.socket = new WebSocket(endpoint)

    return new Promise((resolve, reject) => {
      this.resolveConnect = resolve
      this.rejectConnect = reject
      this.socket?.once("open", () => {
        this.send({
          type: "connection.join",
          sessionId: this.options.sessionId,
          role: "player",
          ...(this.options.resumeToken
            ? { resumeToken: this.options.resumeToken }
            : {
                name: this.options.name,
                participantType: this.options.type,
                ...(this.options.identityToken ? { identityToken: this.options.identityToken } : {}),
                ...(this.options.agent ? { agent: this.options.agent } : {}),
                ...(this.options.color ? { requestedColor: this.options.color } : {})
              })
        })
      })
      this.socket?.on("message", raw => this.handleMessage(raw.toString()))
      this.socket?.once("error", error => {
        if (!this.accepted) reject(error)
      })
      this.socket?.once("close", () => {
        if (!this.accepted) reject(new Error("Connection closed before joining the session"))
      })
    })
  }

  resign(): void {
    this.send({ type: "game.resign" })
  }

  playMove(command: MoveCommand, expectedPly: number): void {
    if (!this.accepted) throw new Error("Player is not connected")
    this.send({ type: "player.status", status: "decided" })
    this.send({
      type: "move.play",
      requestId: randomUUID(),
      expectedPly,
      ...command
    })
  }

  close(): void {
    this.socket?.close()
  }

  private handleMessage(raw: string): void {
    let event: ServerEvent
    try {
      event = JSON.parse(raw) as ServerEvent
    } catch {
      return
    }
    this.eventHandler?.(event)

    if (event.type === "connection.accepted") {
      this.accepted = true
      this.send({ type: "player.ready" })
      this.resolveConnect?.()
      this.resolveConnect = undefined
      this.rejectConnect = undefined
      return
    }
    if (event.type === "error" && !this.accepted) {
      this.rejectConnect?.(new Error(`${event.code}: ${event.message}`))
      this.socket?.close()
      return
    }
    if (event.type === "turn.started" && !this.options.manual) void this.playTurn(event)
  }

  private async playTurn(event: Extract<ServerEvent, { type: "turn.started" }>): Promise<void> {
    const turnKey = `${event.gameId}:${event.ply}`
    if (this.currentTurn === turnKey) return
    this.currentTurn = turnKey
    this.send({ type: "player.status", status: "thinking" })

    const context: TurnContext = {
      gameId: event.gameId,
      fen: event.fen,
      color: event.color,
      ply: event.ply,
      ...(event.lastMove ? { lastMove: event.lastMove } : {}),
      legalMoves: event.legalMoves
    }

    let command: MoveCommand | undefined
    try {
      command = await this.turnHandler?.(context)
    } catch (error) {
      this.eventHandler?.({
        type: "error",
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Turn handler failed"
      })
    }

    const chosenUci = command
      ? `${command.from}${command.to}${command.promotion ?? ""}`
      : ""
    if (!command || !event.legalMoves.includes(chosenUci)) {
      const fallback = event.legalMoves[Math.floor(Math.random() * event.legalMoves.length)]
      command = fallback ? parseUci(fallback) : undefined
    }
    if (!command) {
      this.resign()
      return
    }

    this.send({ type: "player.status", status: "decided" })
    this.send({
      type: "move.play",
      requestId: randomUUID(),
      expectedPly: event.ply,
      ...command
    })
  }

  private send(event: object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(event))
  }
}
