import { defineGame, type ActionResult, type TurnBasedGame } from "@llm-chess/core"
import { oppositeColor, type Color, type GameResult, type TicTacToeMove } from "@llm-chess/protocol"

export type Cell = Color | null
export interface TicTacToeState {
  board: Cell[]
  turn: Color
  ply: number
  moves: TicTacToeMove[]
  status: "playing" | "finished"
  result?: GameResult
}

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
] as const

export class TicTacToeGame implements TurnBasedGame<
  Color, number, TicTacToeMove, TicTacToeState, TicTacToeState, GameResult["reason"]
> {
  readonly gameType = "tic-tac-toe"
  readonly seats = ["white", "black"] as const
  private readonly board: Cell[] = Array(9).fill(null)
  private readonly moves: TicTacToeMove[] = []
  private result?: GameResult

  constructor(readonly id: string) {}

  getCurrentSeat(): Color {
    return this.moves.length % 2 === 0 ? "white" : "black"
  }

  getPublicState(): TicTacToeState {
    return {
      board: [...this.board],
      turn: this.getCurrentSeat(),
      ply: this.moves.length,
      moves: this.getHistory(),
      status: this.isFinished() ? "finished" : "playing",
      ...(this.result ? { result: this.result } : {})
    }
  }

  getPlayerState(_seat: Color): TicTacToeState {
    return this.getPublicState()
  }

  getLegalActions(seat: Color): number[] {
    if (this.isFinished() || seat !== this.getCurrentSeat()) return []
    return this.board.flatMap((cell, index) => cell === null ? [index] : [])
  }

  submitAction(seat: Color, cell: number): ActionResult<TicTacToeMove> {
    if (this.isFinished()) return { valid: false, reason: "game-finished" }
    if (seat !== this.getCurrentSeat()) return { valid: false, reason: "wrong-turn" }
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || this.board[cell] !== null) {
      return { valid: false, reason: "invalid-action" }
    }
    this.board[cell] = seat
    const move = { cell, color: seat }
    this.moves.push(move)
    if (WINNING_LINES.some(line => line.every(index => this.board[index] === seat))) {
      this.result = { reason: "three-in-a-row", winner: seat }
    } else if (this.moves.length === 9) {
      this.result = { reason: "draw", winner: null }
    }
    return { valid: true, action: move }
  }

  resign(seat: Color): GameResult | undefined {
    return this.finish({ reason: "resignation", winner: oppositeColor(seat) })
  }

  finish(outcome: GameResult): GameResult | undefined {
    if (this.isFinished()) return undefined
    this.result = { ...outcome }
    return this.result
  }

  getHistory(): TicTacToeMove[] { return [...this.moves] }
  getActionCount(): number { return this.moves.length }
  isFinished(): boolean { return Boolean(this.result) }
  getOutcome(): GameResult | undefined { return this.result }
}

export const ticTacToeGameDefinition = defineGame({
  gameType: "tic-tac-toe",
  seats: ["white", "black"] as const,
  create(id: string) { return new TicTacToeGame(id) }
})
