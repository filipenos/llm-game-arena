import { moveToUci } from "@llm-chess/chess"
import { oppositeColor, type ClientEvent, type Color, type GameResult, type ServerEvent } from "@llm-chess/protocol"
import { DomainError } from "./domain.js"
import {
  SessionManager,
  type ParticipantRecord,
  type SessionRecord
} from "./session-manager.js"

export interface EventSink {
  send(event: ServerEvent): void
  close?(): void
}

export interface ConnectionBinding {
  sessionId: string
  role: "player" | "spectator"
  participantId?: string
}

export const TURN_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_GAME_PLIES = 300

export interface ArenaServiceOptions {
  manageTurnTimers?: boolean
  maxGamePlies?: number
  now?: () => number
  turnTimeoutMs?: number
}

export class ArenaService {
  private readonly sinks = new Map<string, EventSink>()
  private readonly bindings = new Map<string, ConnectionBinding>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly turnTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly manageTurnTimers: boolean
  private readonly maxGamePlies: number
  private readonly now: () => number
  private readonly turnTimeoutMs: number

  constructor(
    readonly sessions = new SessionManager(),
    options: ArenaServiceOptions = {}
  ) {
    this.manageTurnTimers = options.manageTurnTimers ?? true
    this.maxGamePlies = options.maxGamePlies ?? MAX_GAME_PLIES
    this.now = options.now ?? Date.now
    this.turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS
  }

  addConnection(connectionId: string, sink: EventSink): void {
    this.sinks.set(connectionId, sink)
  }

  restoreConnection(
    connectionId: string,
    sink: EventSink,
    binding?: ConnectionBinding
  ): void {
    this.addConnection(connectionId, sink)
    if (!binding) return
    if (binding.role === "player" && binding.participantId) {
      const session = this.sessions.restorePlayerConnection(binding.participantId, connectionId)
      if (!session || session.id !== binding.sessionId) return
    } else if (binding.role === "spectator") {
      this.sessions.restoreSpectatorConnection(binding.sessionId, connectionId)
    } else {
      return
    }
    this.bindings.set(connectionId, binding)
  }

  connectionBinding(connectionId: string): ConnectionBinding | undefined {
    const binding = this.bindings.get(connectionId)
    return binding ? { ...binding } : undefined
  }

  removeConnection(connectionId: string): void {
    this.sinks.delete(connectionId)
    this.bindings.delete(connectionId)
    const session = this.sessions.disconnect(connectionId)
    if (session) this.broadcastSnapshot(session)
  }

  handleEvent(connectionId: string, event: ClientEvent): Promise<void> {
    if (event.type === "connection.join") {
      return this.handleJoin(connectionId, event)
    }

    const binding = this.bindings.get(connectionId)
    if (!binding) {
      this.sendError(connectionId, new DomainError("MUST_JOIN_FIRST", "Join a session first"))
      return Promise.resolve()
    }

    return this.enqueue(binding.sessionId, async () => {
      try {
        if (event.type === "player.ready") this.handleReady(connectionId)
        else if (event.type === "player.status") this.handleStatus(connectionId, event.status)
        else if (event.type === "move.play") this.handleMove(connectionId, event)
        else if (event.type === "game.resign") this.handleResign(connectionId)
      } catch (error) {
        this.sendError(connectionId, error, event.type === "move.play" ? event.requestId : undefined)
      }
    })
  }

  startSession(sessionId: string, controllerToken: string): SessionRecord {
    const current = this.sessions.getSession(sessionId)
    const alreadyStarted = current.status === "playing" && Boolean(current.game)
    const session = this.sessions.startGame(sessionId, controllerToken)
    const game = session.game
    if (!game) throw new DomainError("INTERNAL_ERROR", "Game was not created", 500)
    if (alreadyStarted) return session

    this.beginTurn(session)

    this.broadcast(session, {
      type: "game.started",
      gameId: game.id,
      fen: game.getPublicState().fen,
      turn: game.getCurrentSeat()
    })
    this.broadcastSnapshot(session)
    this.notifyTurn(session)
    return session
  }

  ensureTurnDeadline(session: SessionRecord): void {
    if (session.status !== "playing" || !session.game) {
      this.cancelTurnTimer(session.id)
      return
    }
    if (!session.turnDeadlineAt) {
      session.turnDeadlineAt = this.now() + this.turnTimeoutMs
      this.sessions.touch(session)
    }
    this.scheduleTurnTimer(session)
  }

  expireTurn(sessionId: string, now = this.now()): boolean {
    const session = this.sessions.getSession(sessionId)
    const game = session.game
    if (session.status !== "playing" || !game || !session.turnDeadlineAt) return false
    if (now < session.turnDeadlineAt) {
      this.scheduleTurnTimer(session)
      return false
    }
    const result = game.finish({
      reason: "turn-timeout",
      winner: oppositeColor(game.getCurrentSeat())
    })
    if (!result) return false
    this.finishGame(session, result)
    return true
  }

  broadcastSnapshot(session: SessionRecord): void {
    this.broadcast(session, { type: "session.snapshot", ...this.sessions.snapshot(session) })
  }

  sendError(connectionId: string, error: unknown, requestId?: string): void {
    const domainError = error instanceof DomainError
      ? error
      : new DomainError("INTERNAL_ERROR", "Internal server error", 500)
    this.send(connectionId, {
      type: "error",
      code: domainError.code,
      message: domainError.message,
      ...(requestId ? { requestId } : {})
    })
  }

  private async handleJoin(
    connectionId: string,
    event: Extract<ClientEvent, { type: "connection.join" }>
  ): Promise<void> {
    if (this.bindings.has(connectionId)) {
      this.sendError(connectionId, new DomainError("ALREADY_JOINED", "Connection already joined"))
      return
    }

    await this.enqueue(event.sessionId, async () => {
      try {
        if (event.role === "spectator") {
          const session = this.sessions.addSpectator(event.sessionId, connectionId)
          this.bindings.set(connectionId, { sessionId: session.id, role: "spectator" })
          this.send(connectionId, {
            type: "connection.accepted",
            connectionId,
            role: "spectator"
          })
          this.send(connectionId, {
            type: "session.snapshot",
            ...this.sessions.snapshot(session)
          })
          return
        }

        const { session, participant } = this.sessions.joinPlayer(event.sessionId, {
          connectionId,
          name: event.name,
          type: event.participantType,
          requestedColor: event.requestedColor,
          resumeToken: event.resumeToken,
          identityToken: event.identityToken,
          agent: event.agent
        })
        this.bindings.set(connectionId, {
          sessionId: session.id,
          role: "player",
          participantId: participant.id
        })
        this.send(connectionId, {
          type: "connection.accepted",
          connectionId,
          role: "player",
          participantId: participant.id,
          color: participant.color,
          resumeToken: participant.resumeToken
        })
        this.broadcastSnapshot(session)
        if (session.status === "playing" && session.game?.getCurrentSeat() === participant.color) {
          this.notifyTurn(session)
        }
      } catch (error) {
        this.sendError(connectionId, error)
      }
    })
  }

  private handleReady(connectionId: string): void {
    const { session, participant } = this.requirePlayer(connectionId)
    this.sessions.markReady(session, participant)
    this.broadcastSnapshot(session)
  }

  private handleStatus(
    connectionId: string,
    status: "thinking" | "decided" | "idle"
  ): void {
    const { session, participant } = this.requirePlayer(connectionId)
    if (session.status !== "playing") {
      throw new DomainError("GAME_NOT_PLAYING", "The game is not running")
    }
    if (session.game?.getCurrentSeat() !== participant.color) {
      throw new DomainError("NOT_YOUR_TURN", "Only the active player can update activity")
    }
    this.sessions.setActivity(session, participant, status)
    this.broadcastSnapshot(session)
  }

  private handleMove(
    connectionId: string,
    event: Extract<ClientEvent, { type: "move.play" }>
  ): void {
    const { session, participant } = this.requirePlayer(connectionId)
    const game = session.game
    if (session.status !== "playing" || !game) {
      throw new DomainError("GAME_NOT_PLAYING", "The game is not running")
    }
    if (session.processedRequestIds.has(event.requestId)) {
      throw new DomainError("DUPLICATE_REQUEST", "Request has already been processed")
    }
    if (event.expectedPly !== game.getActionCount()) {
      throw new DomainError("STALE_PLY", "The game has advanced since this move was selected")
    }
    if (participant.color !== game.getCurrentSeat()) {
      throw new DomainError("NOT_YOUR_TURN", "It is not this player's turn")
    }

    const result = game.submitAction(participant.color, {
      from: event.from,
      to: event.to,
      ...(event.promotion ? { promotion: event.promotion } : {})
    })
    if (!result.valid) {
      this.send(connectionId, {
        type: "move.invalid",
        requestId: event.requestId,
        code: "ILLEGAL_MOVE",
        message: "Illegal move"
      })
      return
    }

    session.processedRequestIds.add(event.requestId)
    participant.activity = "idle"
    this.sessions.touch(session)
    this.broadcast(session, {
      type: "move.made",
      requestId: event.requestId,
      participantId: participant.id,
      move: result.action,
      fen: game.getPublicState().fen,
      turn: game.getCurrentSeat(),
      ply: game.getActionCount()
    })

    const gameResult = game.getOutcome()
    if (gameResult) {
      this.finishGame(session, gameResult)
      return
    }
    if (game.getActionCount() >= this.maxGamePlies) {
      const moveLimitResult = game.finish({ reason: "move-limit", winner: null })
      if (moveLimitResult) this.finishGame(session, moveLimitResult)
      return
    }

    this.beginTurn(session)
    this.broadcastSnapshot(session)
    this.notifyTurn(session)
  }

  private handleResign(connectionId: string): void {
    const { session, participant } = this.requirePlayer(connectionId)
    if (session.status !== "playing" || !session.game) {
      throw new DomainError("GAME_NOT_PLAYING", "The game is not running")
    }
    const result = session.game.resign(participant.color)
    if (!result) throw new DomainError("GAME_NOT_PLAYING", "The game has already finished")
    this.finishGame(session, result)
  }

  private beginTurn(session: SessionRecord): void {
    session.turnDeadlineAt = this.now() + this.turnTimeoutMs
    this.sessions.touch(session)
    this.scheduleTurnTimer(session)
  }

  private finishGame(session: SessionRecord, result: GameResult): void {
    session.status = "finished"
    delete session.turnDeadlineAt
    this.cancelTurnTimer(session.id)
    this.sessions.touch(session)
    this.broadcast(session, { type: "game.finished", result })
    this.broadcastSnapshot(session)
  }

  private scheduleTurnTimer(session: SessionRecord): void {
    if (!this.manageTurnTimers || !session.turnDeadlineAt) return
    this.cancelTurnTimer(session.id)
    const delay = Math.max(0, session.turnDeadlineAt - this.now())
    const timer = setTimeout(() => {
      void this.enqueue(session.id, () => { this.expireTurn(session.id) })
    }, delay)
    timer.unref?.()
    this.turnTimers.set(session.id, timer)
  }

  private cancelTurnTimer(sessionId: string): void {
    const timer = this.turnTimers.get(sessionId)
    if (timer) clearTimeout(timer)
    this.turnTimers.delete(sessionId)
  }

  private notifyTurn(session: SessionRecord): void {
    const game = session.game
    const participant = this.sessions.participantForTurn(session)
    if (!game || !participant?.connectionId || session.status !== "playing") return
    const history = game.getHistory()
    const state = game.getPlayerState(participant.color)
    this.send(participant.connectionId, {
      type: "turn.started",
      gameId: game.id,
      fen: state.fen,
      color: game.getCurrentSeat(),
      ply: game.getActionCount(),
      ...(history.at(-1) ? { lastMove: history.at(-1) } : {}),
      legalMoves: game.getLegalActions(participant.color).map(moveToUci)
    })
  }

  private requirePlayer(
    connectionId: string
  ): { session: SessionRecord; participant: ParticipantRecord } {
    const binding = this.bindings.get(connectionId)
    if (!binding || binding.role !== "player") {
      throw new DomainError("NOT_A_PLAYER", "This connection does not occupy a seat")
    }
    const found = this.sessions.findParticipantByConnection(connectionId)
    if (!found) throw new DomainError("NOT_A_PLAYER", "Player connection was not found")
    return found
  }

  private broadcast(session: SessionRecord, event: ServerEvent): void {
    const connectionIds = new Set(session.spectators)
    if (session.white?.connectionId) connectionIds.add(session.white.connectionId)
    if (session.black?.connectionId) connectionIds.add(session.black.connectionId)
    for (const connectionId of connectionIds) this.send(connectionId, event)
  }

  private send(connectionId: string, event: ServerEvent): void {
    this.sinks.get(connectionId)?.send(event)
  }

  private enqueue(sessionId: string, operation: () => Promise<void> | void): Promise<void> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.queues.set(sessionId, next)
    void next.finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId)
    })
    return next
  }
}

export function seatForColor(session: SessionRecord, color: Color): ParticipantRecord | undefined {
  return color === "white" ? session.white : session.black
}
