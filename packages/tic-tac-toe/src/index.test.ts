import { describe, expect, it } from "vitest"
import { TicTacToeGame } from "./index.js"

describe("TicTacToeGame", () => {
  it("rejects wrong turns and occupied or invalid cells", () => {
    const game = new TicTacToeGame("test")
    expect(game.getLegalActions("white")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(game.submitAction("black", 0)).toEqual({ valid: false, reason: "wrong-turn" })
    expect(game.submitAction("white", 9)).toEqual({ valid: false, reason: "invalid-action" })
    expect(game.submitAction("white", 0).valid).toBe(true)
    expect(game.submitAction("black", 0)).toEqual({ valid: false, reason: "invalid-action" })
    expect(game.getLegalActions("black")).not.toContain(0)
  })

  it("detects wins across a diagonal", () => {
    const game = new TicTacToeGame("test")
    for (const cell of [0, 1, 4, 2, 8]) {
      expect(game.submitAction(game.getCurrentSeat(), cell).valid).toBe(true)
    }
    expect(game.getOutcome()).toEqual({ reason: "three-in-a-row", winner: "white" })
    expect(game.submitAction("black", 3)).toEqual({ valid: false, reason: "game-finished" })
  })

  it("detects a full-board draw", () => {
    const game = new TicTacToeGame("test")
    for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
      expect(game.submitAction(game.getCurrentSeat(), cell).valid).toBe(true)
    }
    expect(game.getOutcome()).toEqual({ reason: "draw", winner: null })
  })
})
