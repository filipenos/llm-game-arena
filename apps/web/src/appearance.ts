export const boardThemes = ["wood", "tournament", "blue", "marble", "contrast"] as const
export const pieceSets = ["staunton", "minimal", "modern", "pixel"] as const

export type BoardTheme = typeof boardThemes[number]
export type PieceSet = typeof pieceSets[number]

export interface BoardAppearance {
  theme: BoardTheme
  pieces: PieceSet
}

export const defaultAppearance: BoardAppearance = {
  theme: "wood",
  pieces: "staunton"
}

const STORAGE_KEY = "llm-game-arena:board-appearance"

function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === "string" && boardThemes.includes(value as BoardTheme)
}

function isPieceSet(value: unknown): value is PieceSet {
  return typeof value === "string" && pieceSets.includes(value as PieceSet)
}

export function parseAppearance(value: unknown): BoardAppearance {
  if (!value || typeof value !== "object") return defaultAppearance
  const candidate = value as Partial<BoardAppearance>
  return {
    theme: isBoardTheme(candidate.theme) ? candidate.theme : defaultAppearance.theme,
    pieces: isPieceSet(candidate.pieces) ? candidate.pieces : defaultAppearance.pieces
  }
}

export function loadAppearance(storage: Pick<Storage, "getItem"> = localStorage): BoardAppearance {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    return stored ? parseAppearance(JSON.parse(stored)) : defaultAppearance
  } catch (error) {
    console.warn("Could not load board appearance", error instanceof Error ? error.message : String(error))
    return defaultAppearance
  }
}

export function saveAppearance(
  appearance: BoardAppearance,
  storage: Pick<Storage, "setItem"> = localStorage
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(parseAppearance(appearance)))
  } catch (error) {
    console.warn("Could not save board appearance", error instanceof Error ? error.message : String(error))
  }
}
