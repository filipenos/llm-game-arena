import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  chessGameDefinition,
  type ChessGameContract
} from "@llm-chess/chess"
import type {
  Color,
  AgentMetadata,
  GameResult,
  MoveCommand,
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
  identityId?: string
  agent?: AgentMetadata
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

export interface PersistedParticipant {
  id: string
  name: string
  type: ParticipantType
  color: Color
  ready: boolean
  activity: PlayerActivity
  resumeToken: string
  identityId?: string
  agent?: AgentMetadata
}

export interface PersistedSession {
  id: string
  gameType: string
  revision: number
  status: SessionStatus
  controllerToken: string
  white?: PersistedParticipant
  black?: PersistedParticipant
  game?: {
    id: string
    moves: MoveCommand[]
    result?: GameResult
  }
  processedRequestIds: string[]
}

export interface JoinPlayerInput {
  connectionId: string
  name?: string
  type?: ParticipantType
  requestedColor?: Color
  resumeToken?: string
  identityToken?: string
  agent?: AgentMetadata
}

export interface JoinPlayerResult {
  session: SessionRecord
  participant: ParticipantRecord
}

function secureToken(): string {
  return Buffer.from(randomBytes(32)).toString("base64url")
}

function agentIdentityId(identityToken: string): string {
  return `agent_${createHash("sha256").update(identityToken).digest("hex")}`
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly gameDefinition = chessGameDefinition
  ) {}

  createSession(requestedId?: string): SessionRecord {
    let id = requestedId ?? this.makeSessionId()
    while (!requestedId && this.sessions.has(id)) id = this.makeSessionId()
    if (this.sessions.has(id)) {
      throw new DomainError("INVALID_MESSAGE", "Session already exists")
    }

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

  persistable(session: SessionRecord): PersistedSession {
    const result = session.game?.getOutcome()
    return {
      id: session.id,
      gameType: session.gameType,
      revision: session.revision,
      status: session.status,
      controllerToken: session.controllerToken,
      ...(session.white ? { white: this.persistableParticipant(session.white) } : {}),
      ...(session.black ? { black: this.persistableParticipant(session.black) } : {}),
      ...(session.game ? {
        game: {
          id: session.game.id,
          moves: session.game.getHistory().map(move => ({
            from: move.from,
            to: move.to,
            ...(move.promotion ? { promotion: move.promotion } : {})
          })),
          ...(result ? { result } : {})
        }
      } : {}),
      processedRequestIds: [...session.processedRequestIds]
    }
  }

  restore(persisted: PersistedSession): SessionRecord {
    if (this.sessions.has(persisted.id)) return this.getSession(persisted.id)
    const session: SessionRecord = {
      id: persisted.id,
      gameType: persisted.gameType,
      revision: persisted.revision,
      status: persisted.status,
      controllerToken: persisted.controllerToken,
      ...(persisted.white ? { white: this.restoreParticipant(persisted.white) } : {}),
      ...(persisted.black ? { black: this.restoreParticipant(persisted.black) } : {}),
      spectators: new Set(),
      processedRequestIds: new Set(persisted.processedRequestIds)
    }
    if (persisted.game) {
      session.game = this.gameDefinition.create(persisted.game.id)
      for (const move of persisted.game.moves) {
        const result = session.game.submitAction(session.game.getCurrentSeat(), move)
        if (!result.valid) throw new Error(`Cannot restore invalid move in session ${session.id}`)
      }
      if (persisted.game.result?.reason === "resignation" && persisted.game.result.winner) {
        session.game.resign(persisted.game.result.winner === "white" ? "black" : "white")
      }
    }
    this.sessions.set(session.id, session)
    return session
  }

  restorePlayerConnection(participantId: string, connectionId: string): SessionRecord | undefined {
    for (const session of this.sessions.values()) {
      const participant = [session.white, session.black].find(candidate => candidate?.id === participantId)
      if (!participant) continue
      participant.connectionId = connectionId
      participant.connected = true
      return session
    }
    return undefined
  }

  restoreSpectatorConnection(sessionId: string, connectionId: string): SessionRecord {
    const session = this.getSession(sessionId)
    session.spectators.add(connectionId)
    return session
  }

  getSession(id: string): SessionRecord {
    const session = this.sessions.get(id)
    if (!session) throw new DomainError("SESSION_NOT_FOUND", "Session not found", 404)
    return session
  }

  listSessions(status?: SessionStatus): SessionRecord[] {
    return [...this.sessions.values()].filter(session => !status || session.status === status)
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
      ...(input.type === "agent" && input.identityToken && input.agent ? {
        identityId: agentIdentityId(input.identityToken),
        agent: { ...input.agent }
      } : {}),
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
    if (session.status === "playing" && session.game) return session
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
      activity: participant.activity,
      ...(participant.identityId ? { identityId: participant.identityId } : {}),
      ...(participant.agent ? { agent: { ...participant.agent } } : {})
    }
  }

  private persistableParticipant(participant: ParticipantRecord): PersistedParticipant {
    return {
      id: participant.id,
      name: participant.name,
      type: participant.type,
      color: participant.color,
      ready: participant.ready,
      activity: participant.activity,
      resumeToken: participant.resumeToken,
      ...(participant.identityId ? { identityId: participant.identityId } : {}),
      ...(participant.agent ? { agent: { ...participant.agent } } : {})
    }
  }

  private restoreParticipant(participant: PersistedParticipant): ParticipantRecord {
    return {
      ...participant,
      connected: false
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
    return available[(randomBytes(1)[0] ?? 0) % available.length]
  }

  private makeSessionId(): string {
    let id = ""
    const bytes = randomBytes(6)
    for (const byte of bytes) id += SESSION_ALPHABET[byte % SESSION_ALPHABET.length]
    return id
  }
}
