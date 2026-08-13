import { describe, expect, it } from "vitest"
import { parseClientEvent, sessionIdSchema } from "./index.js"

describe("sessionIdSchema", () => {
  it("accepts generated six-character session IDs", () => {
    expect(sessionIdSchema.safeParse("K7P4QX").success).toBe(true)
  })

  it("rejects short and ambiguous session IDs", () => {
    expect(sessionIdSchema.safeParse("123").success).toBe(false)
    expect(sessionIdSchema.safeParse("ABC01I").success).toBe(false)
  })
})

describe("parseClientEvent", () => {
  it.each([
    ["unknown event", { type: "unknown" }],
    ["invalid session ID", {
      type: "connection.join", sessionId: "123", role: "spectator"
    }],
    ["player without identity", {
      type: "connection.join", sessionId: "K7P4QX", role: "player"
    }],
    ["invalid square", {
      type: "move.play", requestId: "move", expectedPly: 0, from: "z9", to: "e4"
    }],
    ["negative ply", {
      type: "move.play", requestId: "move", expectedPly: -1, from: "e2", to: "e4"
    }],
    ["invalid promotion", {
      type: "move.play", requestId: "move", expectedPly: 0,
      from: "e7", to: "e8", promotion: "king"
    }]
  ])("rejects %s", (_description, event) => {
    expect(() => parseClientEvent(event)).toThrow()
  })
})
