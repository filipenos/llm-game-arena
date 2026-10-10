import type { ClientEvent, Color, GameResult, GameType, PlayerProgress, PublicGame, ServerEvent } from "@llm-chess/protocol"

export interface ArenaGame {
  readonly id: string
  readonly gameType: GameType
  getCurrentSeat(): Color
  getActionCount(): number
  getOutcome(): GameResult | undefined
  resign(seat: Color): GameResult | undefined
  finish(outcome: GameResult): GameResult | undefined
}

export type GameActionEvent = Extract<ClientEvent, { type: "move.play" | "tic-tac-toe.play" }>

export interface GameAdapter {
  readonly gameType: GameType
  readonly actionType: GameActionEvent["type"]
  create(id: string): ArenaGame
  restore(id: string, moves: unknown[]): ArenaGame
  serialize(game: ArenaGame): unknown[]
  snapshot(
    game: ArenaGame,
    status: "playing" | "finished",
    progress: PlayerProgress[],
    commentaries: Map<number, string>,
    turnDeadlineAt?: number
  ): PublicGame
  started(game: ArenaGame): ServerEvent
  turn(game: ArenaGame, seat: Color): ServerEvent
  play(game: ArenaGame, seat: Color, event: GameActionEvent, participantId: string):
    | { valid: true; event: ServerEvent }
    | { valid: false; message: string }
}

export function commonSnapshot(
  game: ArenaGame,
  status: "playing" | "finished",
  progress: PlayerProgress[],
  turnDeadlineAt?: number
) {
  const result = game.getOutcome()
  return {
    id: game.id,
    turn: game.getCurrentSeat(),
    ply: game.getActionCount(),
    status,
    progress,
    ...(status === "playing" && turnDeadlineAt ? { turnDeadlineAt } : {}),
    ...(result ? { result } : {})
  }
}
