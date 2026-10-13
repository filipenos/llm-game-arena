import { defineGame, type ActionResult, type TurnBasedGame } from "@llm-chess/core"
import { oppositeColor, type CheckersAction, type CheckersCommand, type CheckersMove, type CheckersPiece, type Color, type GameResult } from "@llm-chess/protocol"

const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const

export interface CheckersState {
  board: Array<CheckersPiece | null>
  turn: Color
  ply: number
  moves: CheckersMove[]
  status: "playing" | "finished"
  result?: GameResult
}

function indexAt(row: number, col: number): number | undefined {
  return row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : undefined
}

function rowOf(index: number): number { return Math.floor(index / 8) }
function colOf(index: number): number { return index % 8 }

function initialBoard(): Array<CheckersPiece | null> {
  return Array.from({ length: 64 }, (_, index) => {
    const row = rowOf(index)
    if ((row + colOf(index)) % 2 === 0) return null
    if (row < 3) return { color: "black", king: false }
    if (row > 4) return { color: "white", king: false }
    return null
  })
}

function capturesFrom(
  board: Array<CheckersPiece | null>,
  from: number,
  current: number,
  piece: CheckersPiece,
  path: number[],
  captured: number[],
  results: CheckersAction[]
): void {
  let extended = false
  for (const [dr, dc] of DIRECTIONS) {
    let enemy: number | undefined
    let row = rowOf(current) + dr
    let col = colOf(current) + dc
    while (true) {
      const square = indexAt(row, col)
      if (square === undefined) break
      const occupant = board[square]
      if (enemy !== undefined) {
        if (occupant) break
        const nextBoard = [...board]
        nextBoard[current] = null
        nextBoard[square] = piece
        capturesFrom(nextBoard, from, square, piece, [...path, square], [...captured, enemy], results)
        extended = true
        if (!piece.king) break
      } else if (occupant) {
        if (occupant.color === piece.color || captured.includes(square)) break
        enemy = square
      } else if (!piece.king) {
        break
      }
      row += dr
      col += dc
    }
  }
  if (!extended && captured.length > 0) results.push({ from, path, captures: captured })
}

function legalActions(board: Array<CheckersPiece | null>, seat: Color): CheckersAction[] {
  const captures: CheckersAction[] = []
  for (let from = 0; from < 64; from += 1) {
    const piece = board[from]
    if (piece?.color !== seat) continue
    capturesFrom(board, from, from, piece, [], [], captures)
  }
  if (captures.length > 0) {
    const maximum = Math.max(...captures.map(action => action.captures.length))
    return captures.filter(action => action.captures.length === maximum)
  }

  const moves: CheckersAction[] = []
  for (let from = 0; from < 64; from += 1) {
    const piece = board[from]
    if (piece?.color !== seat) continue
    for (const [dr, dc] of DIRECTIONS) {
      if (!piece.king && dr !== (seat === "white" ? -1 : 1)) continue
      let row = rowOf(from) + dr
      let col = colOf(from) + dc
      while (true) {
        const square = indexAt(row, col)
        if (square === undefined || board[square]) break
        moves.push({ from, path: [square], captures: [] })
        if (!piece.king) break
        row += dr
        col += dc
      }
    }
  }
  return moves
}

function positionKey(board: Array<CheckersPiece | null>, turn: Color): string {
  return `${turn}:${board.map(piece => piece ? `${piece.color[0]}${piece.king ? "K" : "M"}` : "-").join("")}`
}

export class CheckersGame implements TurnBasedGame<
  Color, CheckersCommand, CheckersMove, CheckersState, CheckersState, GameResult["reason"]
> {
  readonly gameType = "checkers"
  readonly seats = ["white", "black"] as const
  private readonly board: Array<CheckersPiece | null>
  private readonly moves: CheckersMove[] = []
  private readonly positions = new Map<string, number>()
  private result?: GameResult
  private kingOnlyPlies = 0

  constructor(readonly id: string, board = initialBoard()) {
    if (board.length !== 64) throw new Error("Checkers board must have 64 squares")
    this.board = board.map(piece => piece ? { ...piece } : null)
    this.positions.set(positionKey(this.board, "white"), 1)
  }

  getCurrentSeat(): Color { return this.moves.length % 2 === 0 ? "white" : "black" }
  getActionCount(): number { return this.moves.length }
  getHistory(): CheckersMove[] { return this.moves.map(move => ({ ...move, path: [...move.path], captures: [...move.captures] })) }
  getOutcome(): GameResult | undefined { return this.result }
  isFinished(): boolean { return Boolean(this.result) }

  getPublicState(): CheckersState {
    return {
      board: this.board.map(piece => piece ? { ...piece } : null),
      turn: this.getCurrentSeat(),
      ply: this.moves.length,
      moves: this.getHistory(),
      status: this.isFinished() ? "finished" : "playing",
      ...(this.result ? { result: { ...this.result } } : {})
    }
  }

  getPlayerState(_seat: Color): CheckersState { return this.getPublicState() }

  getLegalActions(seat: Color): CheckersAction[] {
    return this.isFinished() || seat !== this.getCurrentSeat() ? [] : legalActions(this.board, seat)
  }

  submitAction(seat: Color, command: CheckersCommand): ActionResult<CheckersMove> {
    if (this.isFinished()) return { valid: false, reason: "game-finished" }
    if (seat !== this.getCurrentSeat()) return { valid: false, reason: "wrong-turn" }
    if (!Number.isInteger(command.from) || command.from < 0 || command.from > 63
      || !Array.isArray(command.path) || command.path.length < 1
      || command.path.some(square => !Number.isInteger(square) || square < 0 || square > 63)) {
      return { valid: false, reason: "invalid-action" }
    }
    const action = this.getLegalActions(seat).find(candidate =>
      candidate.from === command.from
      && candidate.path.length === command.path.length
      && candidate.path.every((square, index) => square === command.path[index]))
    if (!action) return { valid: false, reason: "invalid-action" }
    const piece = this.board[action.from]
    if (!piece) return { valid: false, reason: "invalid-action" }
    const destination = action.path.at(-1)
    if (destination === undefined) return { valid: false, reason: "invalid-action" }
    const promoted = !piece.king && rowOf(destination) === (seat === "white" ? 0 : 7)
    this.board[action.from] = null
    for (const captured of action.captures) this.board[captured] = null
    this.board[destination] = { color: seat, king: piece.king || promoted }
    const move: CheckersMove = { ...action, path: [...action.path], captures: [...action.captures], color: seat, promoted }
    this.moves.push(move)
    this.kingOnlyPlies = piece.king && action.captures.length === 0 ? this.kingOnlyPlies + 1 : 0
    if (legalActions(this.board, this.getCurrentSeat()).length === 0) {
      this.result = { reason: "no-legal-moves", winner: seat }
    } else if (this.kingOnlyPlies >= 40) {
      this.result = { reason: "no-progress", winner: null }
    } else {
      const key = positionKey(this.board, this.getCurrentSeat())
      const count = (this.positions.get(key) ?? 0) + 1
      this.positions.set(key, count)
      if (count >= 3) this.result = { reason: "threefold-repetition", winner: null }
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
}

export const checkersGameDefinition = defineGame({
  gameType: "checkers",
  seats: ["white", "black"] as const,
  create(id: string) { return new CheckersGame(id) }
})
