import { Chess } from "chess.js"
import { defineGame, type ActionResult, type TurnBasedGame } from "@llm-chess/core"
import {
  colorFromChessJs,
  oppositeColor,
  type ChessMove,
  type Color,
  type GameFinishReason,
  type GameResult,
  type MoveCommand
} from "@llm-chess/protocol"

export interface ChessState {
  fen: string
  turn: Color
  ply: number
  moves: ChessMove[]
  status: "playing" | "finished"
  result?: GameResult
}

export type ChessGameContract = TurnBasedGame<
  Color,
  MoveCommand,
  ChessMove,
  ChessState,
  ChessState,
  GameFinishReason
>

export interface ChessGameOptions {
  fen?: string
}

export class ChessGame implements ChessGameContract {
  readonly gameType = "chess"
  readonly seats = ["white", "black"] as const
  private readonly chess: Chess
  private readonly moves: ChessMove[] = []
  private forcedResult?: GameResult

  constructor(readonly id: string, options?: ChessGameOptions) {
    this.chess = new Chess(options?.fen)
  }

  getCurrentSeat(): Color {
    return colorFromChessJs(this.chess.turn())
  }

  getPublicState(): ChessState {
    const result = this.getOutcome()
    return {
      fen: this.chess.fen(),
      turn: this.getCurrentSeat(),
      ply: this.moves.length,
      moves: [...this.moves],
      status: result ? "finished" : "playing",
      ...(result ? { result } : {})
    }
  }

  getPlayerState(_seat: Color): ChessState {
    return this.getPublicState()
  }

  getLegalActions(seat: Color): MoveCommand[] {
    if (this.isFinished() || seat !== this.getCurrentSeat()) return []
    return this.chess.moves({ verbose: true }).map(move => ({
      from: move.from,
      to: move.to,
      ...(move.promotion && move.promotion !== "p" && move.promotion !== "k"
        ? { promotion: move.promotion }
        : {})
    }))
  }

  submitAction(seat: Color, command: MoveCommand): ActionResult<ChessMove> {
    if (this.isFinished()) return { valid: false, reason: "game-finished" }
    if (seat !== this.getCurrentSeat()) return { valid: false, reason: "wrong-turn" }

    try {
      const move = this.chess.move(command)
      const normalized: ChessMove = {
        from: move.from,
        to: move.to,
        ...(move.promotion && move.promotion !== "p" && move.promotion !== "k"
          ? { promotion: move.promotion }
          : {}),
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        color: colorFromChessJs(move.color),
        piece: move.piece,
        ...(move.captured ? { captured: move.captured } : {}),
        before: move.before,
        after: move.after
      }
      this.moves.push(normalized)
      return { valid: true, action: normalized }
    } catch {
      return { valid: false, reason: "invalid-action" }
    }
  }

  resign(seat: Color): GameResult | undefined {
    return this.finish({ reason: "resignation", winner: oppositeColor(seat) })
  }

  finish(outcome: GameResult): GameResult | undefined {
    if (this.isFinished()) return undefined
    this.forcedResult = { ...outcome }
    return this.forcedResult
  }

  getHistory(): readonly ChessMove[] {
    return [...this.moves]
  }

  getActionCount(): number {
    return this.moves.length
  }

  isFinished(): boolean {
    return Boolean(this.forcedResult) || this.chess.isGameOver()
  }

  getOutcome(): GameResult | undefined {
    if (this.forcedResult) return this.forcedResult
    if (!this.chess.isGameOver()) return undefined

    if (this.chess.isCheckmate()) {
      return { reason: "checkmate", winner: oppositeColor(this.getCurrentSeat()) }
    }
    if (this.chess.isStalemate()) return { reason: "stalemate", winner: null }
    if (this.chess.isThreefoldRepetition()) {
      return { reason: "threefold-repetition", winner: null }
    }
    if (this.chess.isInsufficientMaterial()) {
      return { reason: "insufficient-material", winner: null }
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return { reason: "fifty-move-rule", winner: null }
    }
    return { reason: "draw", winner: null }
  }
}

export const chessGameDefinition = defineGame({
  gameType: "chess",
  seats: ["white", "black"] as const,
  create(id: string, options?: ChessGameOptions) {
    return new ChessGame(id, options)
  }
})

export function moveToUci(move: MoveCommand): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`
}
