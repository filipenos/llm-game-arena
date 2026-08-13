import { describe, expect, it } from "vitest"
import { ChessGame, chessGameDefinition } from "./index.js"

describe("ChessGame", () => {
  it("implements the generic game contract", () => {
    const game = chessGameDefinition.create("game")
    const result = game.submitAction("white", { from: "e2", to: "e4" })

    expect(result.valid).toBe(true)
    expect(result.valid && result.action.uci).toBe("e2e4")
    expect(game.getCurrentSeat()).toBe("black")
    expect(game.getActionCount()).toBe(1)
    expect(game.getPublicState().fen).toContain(" b ")
  })

  it("rejects an action from the wrong seat", () => {
    const game = new ChessGame("game")

    expect(game.submitAction("black", { from: "e7", to: "e5" })).toEqual({
      valid: false,
      reason: "wrong-turn"
    })
  })

  it("rejects an illegal move without changing the game", () => {
    const game = new ChessGame("game")

    expect(game.submitAction("white", { from: "e2", to: "e5" })).toEqual({
      valid: false,
      reason: "invalid-action"
    })
    expect(game.getActionCount()).toBe(0)
  })

  it("detects checkmate and the winner", () => {
    const game = new ChessGame("game")
    game.submitAction("white", { from: "f2", to: "f3" })
    game.submitAction("black", { from: "e7", to: "e5" })
    game.submitAction("white", { from: "g2", to: "g4" })
    game.submitAction("black", { from: "d8", to: "h4" })

    expect(game.getOutcome()).toEqual({ reason: "checkmate", winner: "black" })
  })

  it("detects stalemate", () => {
    const game = new ChessGame("game", {
      fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"
    })

    expect(game.getOutcome()).toEqual({ reason: "stalemate", winner: null })
  })

  it("detects threefold repetition", () => {
    const game = new ChessGame("game")
    const repeatedMoves = [
      ["white", "g1", "f3"],
      ["black", "g8", "f6"],
      ["white", "f3", "g1"],
      ["black", "f6", "g8"],
      ["white", "g1", "f3"],
      ["black", "g8", "f6"],
      ["white", "f3", "g1"],
      ["black", "f6", "g8"]
    ] as const

    for (const [seat, from, to] of repeatedMoves) {
      expect(game.submitAction(seat, { from, to }).valid).toBe(true)
    }

    expect(game.getOutcome()).toEqual({ reason: "threefold-repetition", winner: null })
  })

  it("detects insufficient material", () => {
    const game = new ChessGame("game", {
      fen: "8/8/8/8/8/8/2k5/K7 w - - 0 1"
    })

    expect(game.getOutcome()).toEqual({ reason: "insufficient-material", winner: null })
  })

  it("detects the fifty-move rule", () => {
    const game = new ChessGame("game", {
      fen: "8/8/8/8/8/8/2k4R/K7 w - - 100 51"
    })

    expect(game.getOutcome()).toEqual({ reason: "fifty-move-rule", winner: null })
  })

  it("supports castling", () => {
    const game = new ChessGame("game", { fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1" })
    const result = game.submitAction("white", { from: "e1", to: "g1" })

    expect(result.valid && result.action.san).toBe("O-O")
  })

  it("supports en passant", () => {
    const game = new ChessGame("game", { fen: "8/8/8/3pP3/8/8/8/4K2k w - d6 0 1" })
    const result = game.submitAction("white", { from: "e5", to: "d6" })

    expect(result.valid && result.action.captured).toBe("p")
  })

  it("supports promotion", () => {
    const game = new ChessGame("game", { fen: "8/P7/8/8/8/8/8/4K2k w - - 0 1" })
    const result = game.submitAction("white", { from: "a7", to: "a8", promotion: "q" })

    expect(result.valid && result.action.promotion).toBe("q")
  })

  it("supports resignation", () => {
    const game = new ChessGame("game")

    expect(game.resign("white")).toEqual({ reason: "resignation", winner: "black" })
    expect(game.isFinished()).toBe(true)
  })
})
