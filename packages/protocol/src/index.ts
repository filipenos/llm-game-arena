import { z } from "zod"

export const colorSchema = z.enum(["white", "black"])
export const participantTypeSchema = z.enum(["human", "agent", "engine"])
export const sessionStatusSchema = z.enum(["waiting", "ready", "playing", "finished"])
export const activitySchema = z.enum(["idle", "thinking", "decided"])
export const playerProgressPhaseSchema = z.enum([
  "received",
  "analyzing",
  "generating",
  "validating",
  "retrying",
  "fallback",
  "decided"
])
export const squareSchema = z.string().regex(/^[a-h][1-8]$/)
export const promotionSchema = z.enum(["q", "r", "b", "n"])
export const sessionIdSchema = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
export const tokenSchema = z.string().min(24).max(200)
export const requestIdSchema = z.string().min(1).max(100)
const singleLineTextSchema = z.string().trim().min(1).max(240).refine(
  value => [...value].every(character => {
    const code = character.charCodeAt(0)
    return code > 31 && code !== 127
  }),
  "Commentary must be one line"
)
export const agentMetadataSchema = z.object({
  player: z.enum(["random", "ollama", "codex", "claude", "openai-compatible"]),
  provider: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160).optional()
})

export type Color = z.infer<typeof colorSchema>
export type ParticipantType = z.infer<typeof participantTypeSchema>
export type SessionStatus = z.infer<typeof sessionStatusSchema>
export type PlayerActivity = z.infer<typeof activitySchema>
export type PlayerProgressPhase = z.infer<typeof playerProgressPhaseSchema>
export type Promotion = z.infer<typeof promotionSchema>
export type AgentMetadata = z.infer<typeof agentMetadataSchema>
export const leaderboardGroupSchema = z.enum(["identity", "player", "provider", "model"])
export type LeaderboardGroup = z.infer<typeof leaderboardGroupSchema>

export const moveCommandSchema = z.object({
  from: squareSchema,
  to: squareSchema,
  promotion: promotionSchema.optional()
})

export type MoveCommand = z.infer<typeof moveCommandSchema>

export interface ChessMove extends MoveCommand {
  san: string
  uci: string
  color: Color
  piece: string
  captured?: string
  before: string
  after: string
  commentary?: string
}

export interface PlayerProgressMetrics {
  attempt?: number
  elapsedMs?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface PlayerProgress extends PlayerProgressMetrics {
  participantId: string
  color: Color
  ply: number
  phase: PlayerProgressPhase
  at: number
}

export type GameFinishReason =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "insufficient-material"
  | "fifty-move-rule"
  | "draw"
  | "resignation"
  | "turn-timeout"
  | "move-limit"

export interface GameResult {
  reason: GameFinishReason
  winner: Color | null
}

export interface PublicParticipant {
  id: string
  name: string
  type: ParticipantType
  color: Color
  connected: boolean
  ready: boolean
  activity: PlayerActivity
  identityId?: string
  agent?: AgentMetadata
  tokenUsage?: TokenUsage
}

export interface PublicGame {
  id: string
  fen: string
  turn: Color
  ply: number
  moves: ChessMove[]
  status: "playing" | "finished"
  turnDeadlineAt?: number
  result?: GameResult
  progress: PlayerProgress[]
}

export interface SessionSnapshot {
  revision: number
  session: {
    id: string
    gameType: string
    status: SessionStatus
    white: PublicParticipant | null
    black: PublicParticipant | null
  }
  game?: PublicGame
}

export interface SessionSummary {
  sessionId: string
  gameType: string
  status: SessionStatus
  whiteName: string | null
  blackName: string | null
  whiteIdentityId?: string | null
  blackIdentityId?: string | null
  whiteAgent?: AgentMetadata | null
  blackAgent?: AgentMetadata | null
  winner: Color | null
  finishReason: GameFinishReason | null
  ply: number
  createdAt?: string
  updatedAt?: string
}

export interface LeaderboardEntry {
  rank: number
  key: string
  label: string
  rating: number
  games: number
  wins: number
  draws: number
  losses: number
  agent?: AgentMetadata
}

export interface LeaderboardResponse {
  gameType: string
  groupBy: LeaderboardGroup
  eligibleGames: number
  truncated: boolean
  entries: LeaderboardEntry[]
}

const playerJoinSchema = z.object({
  type: z.literal("connection.join"),
  sessionId: sessionIdSchema,
  role: z.literal("player"),
  name: z.string().trim().min(1).max(80).optional(),
  participantType: participantTypeSchema.optional(),
  requestedColor: colorSchema.optional(),
  resumeToken: tokenSchema.optional(),
  identityToken: tokenSchema.optional(),
  agent: agentMetadataSchema.optional()
}).superRefine((event, context) => {
  if (!event.resumeToken && (!event.name || !event.participantType)) {
    context.addIssue({
      code: "custom",
      message: "name and participantType are required for a new player"
    })
  }
  if (!event.resumeToken && Boolean(event.identityToken) !== Boolean(event.agent)) {
    context.addIssue({
      code: "custom",
      message: "identityToken and agent metadata must be provided together"
    })
  }
})

const spectatorJoinSchema = z.object({
  type: z.literal("connection.join"),
  sessionId: sessionIdSchema,
  role: z.literal("spectator")
})

export const clientEventSchema = z.union([
  playerJoinSchema,
  spectatorJoinSchema,
  z.object({ type: z.literal("player.ready") }),
  z.object({
    type: z.literal("player.status"),
    status: z.enum(["thinking", "decided", "idle"])
  }),
  z.object({
    type: z.literal("player.progress"),
    expectedPly: z.number().int().nonnegative(),
    phase: playerProgressPhaseSchema,
    attempt: z.number().int().min(1).max(10).optional(),
    elapsedMs: z.number().int().min(0).max(600_000).optional(),
    durationMs: z.number().int().min(0).max(600_000).optional(),
    inputTokens: z.number().int().min(0).max(10_000_000).optional(),
    outputTokens: z.number().int().min(0).max(10_000_000).optional()
  }).strict(),
  z.object({
    type: z.literal("move.play"),
    requestId: requestIdSchema,
    expectedPly: z.number().int().nonnegative(),
    from: squareSchema,
    to: squareSchema,
    promotion: promotionSchema.optional(),
    commentary: singleLineTextSchema.optional()
  }).strict(),
  z.object({ type: z.literal("game.resign") })
])

export type ClientEvent = z.infer<typeof clientEventSchema>

export type ErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_SESSION_ID"
  | "MUST_JOIN_FIRST"
  | "ALREADY_JOINED"
  | "SESSION_NOT_FOUND"
  | "SEAT_OCCUPIED"
  | "SESSION_ALREADY_STARTED"
  | "INVALID_RESUME_TOKEN"
  | "NOT_A_PLAYER"
  | "GAME_NOT_PLAYING"
  | "NOT_YOUR_TURN"
  | "STALE_PLY"
  | "ILLEGAL_MOVE"
  | "DUPLICATE_REQUEST"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "SESSION_NOT_READY"
  | "INTERNAL_ERROR"

export type ServerEvent =
  | {
      type: "connection.accepted"
      connectionId: string
      role: "player" | "spectator"
      participantId?: string
      color?: Color
      resumeToken?: string
    }
  | ({ type: "session.snapshot" } & SessionSnapshot)
  | { type: "game.started"; gameId: string; fen: string; turn: Color }
  | {
      type: "turn.started"
      gameId: string
      fen: string
      color: Color
      ply: number
      lastMove?: ChessMove
      legalMoves: string[]
    }
  | {
      type: "player.progress"
      progress: PlayerProgress
    }
  | {
      type: "move.made"
      requestId: string
      participantId: string
      move: ChessMove
      fen: string
      turn: Color
      ply: number
    }
  | { type: "move.invalid"; requestId: string; code: ErrorCode; message: string }
  | { type: "game.finished"; result: GameResult }
  | { type: "error"; code: ErrorCode; message: string; requestId?: string }

export function parseClientEvent(input: unknown): ClientEvent {
  return clientEventSchema.parse(input)
}

export function colorFromChessJs(color: "w" | "b"): Color {
  return color === "w" ? "white" : "black"
}

export function colorToChessJs(color: Color): "w" | "b" {
  return color === "white" ? "w" : "b"
}

export function oppositeColor(color: Color): Color {
  return color === "white" ? "black" : "white"
}

export function parseUci(uci: string): MoveCommand | undefined {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci.trim().toLowerCase())
  if (!match?.[1] || !match[2]) return undefined
  const command: MoveCommand = { from: match[1], to: match[2] }
  if (match[3]) command.promotion = match[3] as Promotion
  return command
}
