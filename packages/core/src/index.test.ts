import { describe, expect, it } from "vitest"
import { defineGame } from "./index.js"

describe("defineGame", () => {
  it("defines a game independently from any specific rules", () => {
    const definition = defineGame({
      gameType: "counter",
      seats: ["one", "two"] as const,
      create: () => ({
        id: "counter-1",
        gameType: "counter",
        seats: ["one", "two"] as const,
        getCurrentSeat: () => "one" as const,
        getPublicState: () => ({ value: 0 }),
        getPlayerState: () => ({ value: 0 }),
        getLegalActions: () => [1],
        submitAction: () => ({ valid: true as const, action: 1 }),
        resign: () => ({ reason: "resignation", winner: "two" as const }),
        finish: outcome => outcome,
        getHistory: () => [],
        getActionCount: () => 0,
        isFinished: () => false,
        getOutcome: () => undefined
      })
    })

    expect(definition.gameType).toBe("counter")
    expect(definition.seats).toEqual(["one", "two"])
  })

  it("rejects duplicate seats", () => {
    expect(() => defineGame({
      gameType: "invalid",
      seats: ["same", "same"],
      create: () => { throw new Error("not used") }
    })).toThrow("Game seats must be unique")
  })
})
