import type { ChessMove } from "@llm-chess/protocol"
import { describe, expect, it } from "vitest"
import { capturedPieces, pieceSymbol, promotionSymbol } from "./chess-display.js"

const moves = [
  { color: "white", captured: "p" },
  { color: "black", captured: "n" },
  { color: "white" },
  { color: "white", captured: "q" }
] as ChessMove[]

describe("chess display helpers", () => {
  it("groups captured pieces under the player who captured them", () => {
    expect(capturedPieces(moves, "white")).toEqual(["p", "q"])
    expect(capturedPieces(moves, "black")).toEqual(["N"])
  })

  it("uses the promoting pawn color for promotion icons", () => {
    expect(promotionSymbol("q", "white")).toBe("♕")
    expect(promotionSymbol("q", "black")).toBe("♛")
  })

  it("uses chess glyphs or letters according to the selected piece set", () => {
    expect(pieceSymbol("N", "staunton")).toBe("♘")
    expect(pieceSymbol("n", "modern")).toBe("♞")
    expect(pieceSymbol("n", "minimal")).toBe("N")
    expect(pieceSymbol("N", "pixel")).toBe("N")
  })
})
