import { useState } from "react"
import type { CheckersAction, CheckersMove, CheckersPiece, Color } from "@llm-chess/protocol"
import type { BoardTheme, PieceSet } from "./appearance.js"

function squareName(index: number): string {
  return `${String.fromCharCode(97 + index % 8)}${8 - Math.floor(index / 8)}`
}

function startsWith(path: number[], prefix: number[]): boolean {
  return prefix.every((square, index) => path[index] === square)
}

export function CheckersBoard({
  board,
  orientation,
  theme,
  pieceSet,
  enabled,
  legalMoves,
  lastMove,
  onMove
}: {
  board: Array<CheckersPiece | null>
  orientation: Color
  theme: BoardTheme
  pieceSet: PieceSet
  enabled: boolean
  legalMoves: CheckersAction[]
  lastMove?: CheckersMove
  onMove: (from: number, path: number[]) => void
}) {
  const [selectedFrom, setSelectedFrom] = useState<number>()
  const [selectedPath, setSelectedPath] = useState<number[]>([])

  const candidateMoves = selectedFrom === undefined ? [] : legalMoves.filter(move =>
    move.from === selectedFrom && startsWith(move.path, selectedPath))
  const nextSquares = new Set(candidateMoves.map(move => move.path[selectedPath.length]).filter((square): square is number => square !== undefined))
  const origins = new Set(legalMoves.map(move => move.from))
  const mustCapture = enabled && legalMoves.some(move => move.captures.length > 0)
  const captureVictims = new Set((selectedFrom === undefined ? legalMoves : candidateMoves)
    .map(move => move.captures[selectedFrom === undefined ? 0 : selectedPath.length])
    .filter((square): square is number => square !== undefined))
  const preview = [...board]
  if (selectedFrom !== undefined && selectedPath.length > 0) {
    const action = candidateMoves[0]
    const piece = board[selectedFrom]
    const destination = selectedPath.at(-1)
    if (action && piece && destination !== undefined) {
      preview[selectedFrom] = null
      for (const captured of action.captures.slice(0, selectedPath.length)) preview[captured] = null
      preview[destination] = piece
    }
  }

  function select(square: number): void {
    if (!enabled) return
    if (selectedFrom !== undefined && nextSquares.has(square)) {
      const path = [...selectedPath, square]
      const matches = candidateMoves.filter(move => startsWith(move.path, path))
      if (matches.some(move => move.path.length === path.length)) {
        onMove(selectedFrom, path)
        setSelectedFrom(undefined)
        setSelectedPath([])
      } else {
        setSelectedPath(path)
      }
      return
    }
    if (origins.has(square)) {
      setSelectedFrom(square === selectedFrom && selectedPath.length === 0 ? undefined : square)
      setSelectedPath([])
    }
  }

  const lastDestination = lastMove?.path.at(-1)
  return <>
    <p className={`checkers-help ${mustCapture ? "mandatory" : ""}`} role={mustCapture ? "status" : undefined}>
      {mustCapture ? <><strong>CAPTURA OBRIGATÓRIA</strong><span>{selectedPath.length > 0
        ? "Continue pelos destinos laranja até completar a sequência."
        : selectedFrom === undefined
          ? "Toque em uma peça com borda laranja. Vale a sequência que captura mais peças."
          : "Toque no destino laranja para capturar a peça marcada."}</span></>
        : "Selecione uma peça e depois uma casa destacada."}
    </p>
    <div className={`checkers-board theme-${theme} piece-set-${pieceSet}`} role="group" aria-label="Tabuleiro de damas">
      {Array.from({ length: 64 }, (_, displayIndex) => {
        const square = orientation === "white" ? displayIndex : 63 - displayIndex
        const piece = preview[square]
        const dark = (Math.floor(square / 8) + square % 8) % 2 === 1
        const selected = selectedPath.at(-1) === square || selectedFrom === square && selectedPath.length === 0
        const legal = selectedFrom === undefined ? origins.has(square) : nextSquares.has(square) || origins.has(square)
        return <button
          key={square}
          type="button"
          className={`checkers-square ${dark ? "dark" : "light"} ${selected ? "selected" : ""} ${mustCapture && selected ? "capture-selected" : ""} ${nextSquares.has(square) ? "legal-target" : ""} ${selectedFrom === undefined && origins.has(square) ? "legal-origin" : ""} ${mustCapture && origins.has(square) && selectedFrom === undefined ? "mandatory-origin" : ""} ${mustCapture && nextSquares.has(square) ? "capture-target" : ""} ${mustCapture && captureVictims.has(square) ? "capture-victim" : ""} ${lastMove?.from === square || lastDestination === square ? "last-move" : ""}`}
          aria-label={`Casa ${squareName(square)}${piece ? `, ${piece.king ? "dama" : "pedra"} ${piece.color === "white" ? "branca" : "preta"}` : ""}${mustCapture && origins.has(square) && selectedFrom === undefined ? ", captura obrigatória" : ""}`}
          disabled={!enabled || !legal}
          onClick={() => select(square)}
        >
          {piece && <span className={`checkers-piece ${piece.color} ${piece.king ? "king" : ""}`} aria-hidden="true">
            {piece.king && <span className="checkers-crown">♛</span>}
          </span>}
        </button>
      })}
    </div>
  </>
}
