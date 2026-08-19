import type { GameResult, TokenUsage } from "@llm-chess/protocol"

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

export function formatTokenUsage(usage: TokenUsage, language: "pt" | "en"): string {
  const locale = language === "pt" ? "pt-BR" : "en-US"
  const input = usage.inputTokens.toLocaleString(locale)
  const output = usage.outputTokens.toLocaleString(locale)
  const total = usage.totalTokens.toLocaleString(locale)
  return language === "pt"
    ? `Tokens: ↓${input} entrada · ↑${output} saída · Σ${total}.`
    : `Tokens: ↓${input} input · ↑${output} output · Σ${total}.`
}
