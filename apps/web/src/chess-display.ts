import type { ChessMove, Color, Promotion } from "@llm-chess/protocol"
import type { PieceSet } from "./appearance.js"

export const pieceSymbols: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
}

const pieceLetters: Record<string, string> = {
  K: "K", Q: "Q", R: "R", B: "B", N: "N", P: "P",
  k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P"
}

export function pieceSymbol(piece: string, set: PieceSet): string {
  return set === "staunton" || set === "modern"
    ? pieceSymbols[piece] ?? ""
    : pieceLetters[piece] ?? ""
}

export const promotionChoices: Array<{
  value: Promotion
  label: string
  piece: "q" | "r" | "b" | "n"
}> = [
  { value: "q", label: "Dama", piece: "q" },
  { value: "r", label: "Torre", piece: "r" },
  { value: "b", label: "Bispo", piece: "b" },
  { value: "n", label: "Cavalo", piece: "n" }
]

export function capturedPieces(moves: ChessMove[], captor: Color): string[] {
  return moves.flatMap(move => {
    if (move.color !== captor || !move.captured) return []
    const piece = captor === "white" ? move.captured.toLowerCase() : move.captured.toUpperCase()
    return pieceSymbols[piece] ? [piece] : []
  })
}

export function promotionSymbol(piece: string, color: Color, set: PieceSet = "staunton"): string {
  const key = color === "white" ? piece.toUpperCase() : piece.toLowerCase()
  return pieceSymbol(key, set)
}
