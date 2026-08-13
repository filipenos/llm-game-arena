import { randomBytes, randomUUID } from "node:crypto"
import {
  chessGameDefinition,
  type ChessGameContract
} from "@llm-chess/chess"
import type {
  Color,
  ParticipantType,
  PlayerActivity,
  SessionSnapshot,
  SessionStatus
} from "@llm-chess/protocol"
import { DomainError } from "./domain.js"

const SESSION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export interface ParticipantRecord {
  id: string
  name: string
  type: ParticipantType
  color: Color
  connected: boolean
  ready: boolean
  activity: PlayerActivity
  resumeToken: string
  connectionId?: string
}

export interface SessionRecord {
  id: string
  gameType: string
  revision: number
  status: SessionStatus
  controllerToken: string
  white?: ParticipantRecord
  black?: ParticipantRecord
  spectators: Set<string>
  game?: ChessGameContract
  processedRequestIds: Set<string>
}

export interface JoinPlayerInput {
  connectionId: string
  name?: string
  type?: ParticipantType
  requestedColor?: Color
  resumeToken?: string
}

export interface JoinPlayerResult {
  session: SessionRecord
  participant: ParticipantRecord
}

function secureToken(): string {
  return randomBytes(32).toString("base64url")
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly gameDefinition = chessGameDefinition
  ) {}

  createSession(): SessionRecord {
    let id = this.makeSessionId()
    while (this.sessions.has(id)) id = this.makeSessionId()

    const session: SessionRecord = {
      id,
      gameType: this.gameDefinition.gameType,
      revision: 0,
      status: "waiting",
      controllerToken: secureToken(),
      spectators: new Set(),
      processedRequestIds: new Set()
    }
    this.sessions.set(id, session)
    return session
  }

  getSession(id: string): SessionRecord {
    const session = this.sessions.get(id)
    if (!session) throw new DomainError("SESSION_NOT_FOUND", "Session not found", 404)
    return session
  }

  addSpectator(sessionId: string, connectionId: string): SessionRecord {
    const session = this.getSession(sessionId)
    session.spectators.add(connectionId)
    return session
  }

  joinPlayer(sessionId: string, input: JoinPlayerInput): JoinPlayerResult {
    const session = this.getSession(sessionId)
    if (input.resumeToken) return this.resumePlayer(session, input.connectionId, input.resumeToken)
    if (session.status === "playing" || session.status === "finished") {
      throw new DomainError("SESSION_ALREADY_STARTED", "The game has already started")
    }
    if (!input.name || !input.type) {
      throw new DomainError("INVALID_MESSAGE", "Name and participant type are required")
    }

    const color = input.requestedColor ?? this.randomAvailableColor(session)
    if (!color || this.getSeat(session, color)) {
      throw new DomainError("SEAT_OCCUPIED", "The requested seat is occupied")
    }

    const participant: ParticipantRecord = {
      id: `p_${randomUUID()}`,
      name: input.name,
      type: input.type,
      color,
      connected: true,
      ready: false,
      activity: "idle",
      resumeToken: secureToken(),
      connectionId: input.connectionId
    }
    this.setSeat(session, color, participant)
    this.touch(session)
    return { session, participant }
  }

  markReady(session: SessionRecord, participant: ParticipantRecord): void {
    participant.ready = true
    this.recalculateStatus(session)
    this.touch(session)
  }

  setActivity(
    session: SessionRecord,
    participant: ParticipantRecord,
    activity: PlayerActivity
  ): void {
    participant.activity = activity
    this.touch(session)
  }

  disconnect(connectionId: string): SessionRecord | undefined {
    for (const session of this.sessions.values()) {
      if (session.spectators.delete(connectionId)) return session
      for (const participant of [session.white, session.black]) {
        if (participant?.connectionId !== connectionId) continue
        participant.connected = false
        participant.ready = false
        participant.activity = "idle"
        delete participant.connectionId
        this.recalculateStatus(session)
        this.touch(session)
        return session
      }
    }
    return undefined
  }

  startGame(sessionId: string, controllerToken: string): SessionRecord {
    const session = this.getSession(sessionId)
    if (session.controllerToken !== controllerToken) {
      throw new DomainError("UNAUTHORIZED", "Invalid controller token", 401)
    }
    if (session.status !== "ready") {
      throw new DomainError("SESSION_NOT_READY", "Both players must be connected and ready")
    }
    session.game = this.gameDefinition.create(`g_${randomUUID()}`)
    session.status = "playing"
    this.touch(session)
    return session
  }

  findParticipantByConnection(
    connectionId: string
  ): { session: SessionRecord; participant: ParticipantRecord } | undefined {
    for (const session of this.sessions.values()) {
      for (const participant of [session.white, session.black]) {
        if (participant?.connectionId === connectionId) return { session, participant }
      }
    }
    return undefined
  }

  snapshot(session: SessionRecord): SessionSnapshot {
    return {
      revision: session.revision,
      session: {
        id: session.id,
        gameType: session.gameType,
        status: session.status,
        white: session.white ? this.publicParticipant(session.white) : null,
        black: session.black ? this.publicParticipant(session.black) : null
      },
      ...(session.game
        ? {
            game: {
              id: session.game.id,
              fen: session.game.getPublicState().fen,
              turn: session.game.getCurrentSeat(),
              ply: session.game.getActionCount(),
              moves: [...session.game.getHistory()],
              status: session.status === "finished" ? "finished" as const : "playing" as const,
              ...(session.game.getOutcome() ? { result: session.game.getOutcome() } : {})
            }
          }
        : {})
    }
  }

  touch(session: SessionRecord): void {
    session.revision += 1
  }

  participantForTurn(session: SessionRecord): ParticipantRecord | undefined {
    if (!session.game) return undefined
    return this.getSeat(session, session.game.getCurrentSeat())
  }

  private resumePlayer(
    session: SessionRecord,
    connectionId: string,
    resumeToken: string
  ): JoinPlayerResult {
    const participant = [session.white, session.black].find(
      candidate => candidate?.resumeToken === resumeToken
    )
    if (!participant) {
      throw new DomainError("INVALID_RESUME_TOKEN", "Invalid resume token", 401)
    }
    participant.connectionId = connectionId
    participant.connected = true
    participant.activity = "idle"
    this.recalculateStatus(session)
    this.touch(session)
    return { session, participant }
  }

  private recalculateStatus(session: SessionRecord): void {
    if (session.status === "playing" || session.status === "finished") return
    session.status = session.white?.connected && session.white.ready
      && session.black?.connected && session.black.ready
      ? "ready"
      : "waiting"
  }

  private publicParticipant(participant: ParticipantRecord) {
    return {
      id: participant.id,
      name: participant.name,
      type: participant.type,
      color: participant.color,
      connected: participant.connected,
      ready: participant.ready,
      activity: participant.activity
    }
  }

  private getSeat(session: SessionRecord, color: Color): ParticipantRecord | undefined {
    return color === "white" ? session.white : session.black
  }

  private setSeat(session: SessionRecord, color: Color, participant: ParticipantRecord): void {
    if (color === "white") session.white = participant
    else session.black = participant
  }

  private randomAvailableColor(session: SessionRecord): Color | undefined {
    const available: Color[] = []
    if (!session.white) available.push("white")
    if (!session.black) available.push("black")
    if (available.length < 2) return available[0]
    return available[randomBytes(1).readUInt8(0) % available.length]
  }

  private makeSessionId(): string {
    let id = ""
    const bytes = randomBytes(6)
    for (const byte of bytes) id += SESSION_ALPHABET[byte % SESSION_ALPHABET.length]
    return id
  }
}
