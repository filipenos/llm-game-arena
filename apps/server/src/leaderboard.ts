import type {
  AgentMetadata,
  Color,
  LeaderboardEntry,
  LeaderboardGroup,
  LeaderboardResponse
} from "@llm-chess/protocol"

const INITIAL_RATING = 1200
const K_FACTOR = 32

export interface RankedParticipant {
  identityId?: string | null
  name?: string | null
  agent?: AgentMetadata | null
}

export interface RankedMatch {
  gameType: string
  winner: Color | null
  white: RankedParticipant
  black: RankedParticipant
}

interface MutableEntry extends Omit<LeaderboardEntry, "rank" | "rating"> {
  rating: number
}

function grouping(
  participant: RankedParticipant,
  groupBy: LeaderboardGroup
): { key: string; label: string; agent?: AgentMetadata } | undefined {
  const agent = participant.agent ?? undefined
  if (groupBy === "identity") {
    if (!participant.identityId || !agent) return undefined
    return {
      key: participant.identityId,
      label: participant.name?.trim() || participant.identityId,
      agent
    }
  }
  if (!agent) return undefined
  if (groupBy === "player") {
    return { key: agent.player, label: agent.player }
  }
  if (groupBy === "provider") {
    return { key: agent.provider, label: agent.provider }
  }
  if (!agent.model) return undefined
  return {
    key: `${agent.provider}:${agent.model}`,
    label: agent.model,
    agent
  }
}

function entryFor(
  entries: Map<string, MutableEntry>,
  grouped: { key: string; label: string; agent?: AgentMetadata }
): MutableEntry {
  const existing = entries.get(grouped.key)
  if (existing) {
    existing.label = grouped.label
    if (grouped.agent) existing.agent = grouped.agent
    return existing
  }
  const created: MutableEntry = {
    key: grouped.key,
    label: grouped.label,
    rating: INITIAL_RATING,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    ...(grouped.agent ? { agent: grouped.agent } : {})
  }
  entries.set(grouped.key, created)
  return created
}

function score(winner: Color | null, color: Color): number {
  if (!winner) return 0.5
  return winner === color ? 1 : 0
}

export function calculateLeaderboard(
  matches: RankedMatch[],
  gameType: string,
  groupBy: LeaderboardGroup,
  limit = 20
): LeaderboardResponse {
  const entries = new Map<string, MutableEntry>()
  let eligibleGames = 0

  for (const match of matches) {
    if (match.gameType !== gameType) continue
    const whiteGroup = grouping(match.white, groupBy)
    const blackGroup = grouping(match.black, groupBy)
    if (!whiteGroup || !blackGroup || whiteGroup.key === blackGroup.key) continue

    eligibleGames += 1
    const white = entryFor(entries, whiteGroup)
    const black = entryFor(entries, blackGroup)
    const whiteScore = score(match.winner, "white")
    const blackScore = 1 - whiteScore
    const whiteExpected = 1 / (1 + 10 ** ((black.rating - white.rating) / 400))
    const blackExpected = 1 - whiteExpected
    const whiteRating = white.rating + K_FACTOR * (whiteScore - whiteExpected)
    const blackRating = black.rating + K_FACTOR * (blackScore - blackExpected)

    white.rating = whiteRating
    black.rating = blackRating
    white.games += 1
    black.games += 1
    if (whiteScore === 1) {
      white.wins += 1
      black.losses += 1
    } else if (whiteScore === 0) {
      white.losses += 1
      black.wins += 1
    } else {
      white.draws += 1
      black.draws += 1
    }
  }

  const ranked = [...entries.values()]
    .sort((left, right) => right.rating - left.rating
      || right.games - left.games
      || right.wins - left.wins
      || left.key.localeCompare(right.key))
    .slice(0, Math.max(1, limit))
    .map((entry, index): LeaderboardEntry => ({
      ...entry,
      rank: index + 1,
      rating: Math.round(entry.rating)
    }))

  return { gameType, groupBy, eligibleGames, truncated: false, entries: ranked }
}
