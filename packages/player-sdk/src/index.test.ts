import { describe, expect, it } from "vitest"
import { playerWebSocketUrl } from "./index.js"

describe("playerWebSocketUrl", () => {
  it("includes the session ID for routed WebSocket backends", () => {
    expect(playerWebSocketUrl("wss://chess.filipenos.com", "K7P4QX").toString()).toBe(
      "wss://chess.filipenos.com/ws?session=K7P4QX"
    )
  })

  it("preserves local WebSocket support", () => {
    expect(playerWebSocketUrl("ws://localhost:3001", "ABC234").toString()).toBe(
      "ws://localhost:3001/ws?session=ABC234"
    )
  })
})
