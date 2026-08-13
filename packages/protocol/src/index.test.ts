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
    ["agent without stable identity metadata", {
      type: "connection.join", sessionId: "K7P4QX", role: "player",
      name: "Codex", participantType: "agent"
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

  it("accepts a stable agent identity and model metadata", () => {
    expect(parseClientEvent({
      type: "connection.join",
      sessionId: "K7P4QX",
      role: "player",
      name: "Codex",
      participantType: "agent",
      identityToken: "stable-secret-identity-token-for-codex",
      agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
    })).toMatchObject({
      identityToken: "stable-secret-identity-token-for-codex",
      agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
    })
  })
})
