import { describe, expect, it } from "vitest"
import type { CheckersPiece } from "@llm-chess/protocol"
import { CheckersGame } from "./index.js"

function position(entries: Array<[number, CheckersPiece]>): Array<CheckersPiece | null> {
  const board: Array<CheckersPiece | null> = Array(64).fill(null)
  for (const [square, piece] of entries) board[square] = piece
  return board
}

const white = { color: "white", king: false } as const
const black = { color: "black", king: false } as const

describe("CheckersGame", () => {
  it("starts with twelve pieces per side and white moving forward", () => {
    const game = new CheckersGame("game")
    const board = game.getPublicState().board
    expect(board.filter(piece => piece?.color === "white")).toHaveLength(12)
    expect(board.filter(piece => piece?.color === "black")).toHaveLength(12)
    expect(game.getCurrentSeat()).toBe("white")
    expect(game.getLegalActions("white").every(action => action.path[0]! < action.from)).toBe(true)
  })

  it("requires a backward capture instead of an ordinary move", () => {
    const game = new CheckersGame("game", position([[26, white], [35, black], [1, black]]))
    expect(game.getLegalActions("white")).toEqual([{ from: 26, path: [44], captures: [35] }])
    expect(game.submitAction("white", { from: 26, path: [19] }).valid).toBe(false)
    expect(game.submitAction("white", { from: 26, path: [44] }).valid).toBe(true)
    expect(game.getPublicState().board[35]).toBeNull()
  })

  it("enforces the greatest number of captured pieces", () => {
    const game = new CheckersGame("game", position([
      [42, white], [33, black], [35, black], [21, black], [1, black]
    ]))
    expect(game.getLegalActions("white")).toEqual([{
      from: 42, path: [28, 14], captures: [35, 21]
    }])
    expect(game.submitAction("white", { from: 42, path: [24] }).valid).toBe(false)
  })

  it("lets a king land anywhere beyond one captured piece", () => {
    const game = new CheckersGame("game", position([
      [40, { color: "white", king: true }], [26, black], [1, black]
    ]))
    const landingSquares = game.getLegalActions("white").map(action => action.path[0]).sort((a, b) => a! - b!)
    expect(landingSquares).toEqual([5, 12, 19])
    expect(game.submitAction("white", { from: 40, path: [12] }).valid).toBe(true)
    expect(game.getPublicState().board[26]).toBeNull()
  })

  it("promotes only after completing the move and wins when the opponent cannot move", () => {
    const game = new CheckersGame("game", position([[10, white], [56, black]]))
    expect(game.submitAction("white", { from: 10, path: [1] }).valid).toBe(true)
    expect(game.getPublicState().board[1]).toEqual({ color: "white", king: true })
    expect(game.getOutcome()).toEqual({ reason: "no-legal-moves", winner: "white" })
  })

  it("continues a capture as a man after touching the promotion row", () => {
    const game = new CheckersGame("game", position([
      [17, white], [10, black], [12, black], [56, black]
    ]))
    expect(game.getLegalActions("white")).toContainEqual({
      from: 17, path: [3, 21], captures: [10, 12]
    })
    expect(game.submitAction("white", { from: 17, path: [3] }).valid).toBe(false)
    expect(game.submitAction("white", { from: 17, path: [3, 21] }).valid).toBe(true)
    expect(game.getPublicState().board[21]).toEqual(white)
  })
})
