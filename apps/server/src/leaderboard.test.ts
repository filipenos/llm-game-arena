import { describe, expect, it } from "vitest"
import { calculateLeaderboard, type RankedMatch } from "./leaderboard.js"

const codex = { player: "codex" as const, provider: "openai", model: "gpt-5.6-sol" }
const claude = { player: "claude" as const, provider: "anthropic", model: "opus-5.6" }

function match(winner: "white" | "black" | null): RankedMatch {
  return {
    gameType: "chess",
    winner,
    white: { identityId: "agent_codex", name: "Codex", agent: codex },
    black: { identityId: "agent_claude", name: "Claude", agent: claude }
  }
}

describe("calculateLeaderboard", () => {
  it("calculates chronological Elo and records", () => {
    const leaderboard = calculateLeaderboard([
      match("white"),
      match(null),
      match("black")
    ], "chess", "model")

    expect(leaderboard.eligibleGames).toBe(3)
    expect(leaderboard.entries).toEqual([
      expect.objectContaining({
        rank: 1,
        key: "anthropic:opus-5.6",
        rating: 1203,
        games: 3,
        wins: 1,
        draws: 1,
        losses: 1
      }),
      expect.objectContaining({
        rank: 2,
        key: "openai:gpt-5.6-sol",
        rating: 1197,
        games: 3,
        wins: 1,
        draws: 1,
        losses: 1
      })
    ])
  })

  it("excludes humans, missing models and matches inside one group", () => {
    const leaderboard = calculateLeaderboard([
      match("white"),
      { ...match("white"), black: { name: "Human" } },
      { ...match("white"), black: { ...match("white").black, agent: codex } }
    ], "chess", "model")

    expect(leaderboard.eligibleGames).toBe(1)
    expect(leaderboard.entries).toHaveLength(2)
  })

  it("supports identity, player and provider groupings", () => {
    expect(calculateLeaderboard([match("white")], "chess", "identity").entries[0]?.label)
      .toBe("Codex")
    expect(calculateLeaderboard([match("white")], "chess", "player").entries[0]?.key)
      .toBe("codex")
    expect(calculateLeaderboard([match("white")], "chess", "provider").entries[0]?.key)
      .toBe("openai")
  })
})
