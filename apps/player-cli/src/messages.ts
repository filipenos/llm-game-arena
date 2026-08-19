import type { GameResult } from "@llm-chess/protocol"

export function formatGameFinished(result: GameResult, language: "pt" | "en"): string {
  if (language === "en") {
    return `Game finished: ${result.reason}; winner: ${result.winner ?? "draw"}.`
  }
  const reason = ({
    checkmate: "xeque-mate",
    stalemate: "afogamento",
    "threefold-repetition": "repetição tripla",
    "insufficient-material": "material insuficiente",
    "fifty-move-rule": "regra dos 50 lances",
    draw: "empate",
    resignation: "desistência",
    "turn-timeout": "tempo esgotado",
    "move-limit": "limite de jogadas"
  } as Record<GameResult["reason"], string>)[result.reason]
  const winner = result.winner === "white"
    ? "brancas"
    : result.winner === "black" ? "pretas" : "empate"
  return `Partida encerrada: ${reason}; vencedor: ${winner}.`
}
