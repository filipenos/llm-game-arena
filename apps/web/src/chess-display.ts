import type { ChessMove, Color, Promotion } from "@llm-chess/protocol"

export const pieceSymbols: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
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

export function promotionSymbol(piece: string, color: Color): string {
  const key = color === "white" ? piece.toUpperCase() : piece.toLowerCase()
  return pieceSymbols[key] ?? ""
}
