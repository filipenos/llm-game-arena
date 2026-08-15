import { describe, expect, it, vi } from "vitest"
import type { PlayerClientOptions } from "@llm-chess/player-sdk"
import type { MoveCommand, ServerEvent } from "@llm-chess/protocol"
import { ArenaBridge } from "./arena-bridge.js"

class MockPlayer {
  private handler?: (event: ServerEvent) => void
  readonly moves: Array<{ command: MoveCommand; ply: number }> = []
  closed = false

  onEvent(handler: (event: ServerEvent) => void): void {
    this.handler = handler
  }

  async connect(): Promise<void> {
    this.emit({
      type: "connection.accepted",
      connectionId: "connection-1",
      role: "player",
      participantId: "participant-1",
      color: "white",
      resumeToken: "resume-token-with-enough-characters"
    })
  }

  playMove(command: MoveCommand, expectedPly: number): void {
    this.moves.push({ command, ply: expectedPly })
  }

  resign(): void {}

  close(): void {
    this.closed = true
  }

  emit(event: ServerEvent): void {
    this.handler?.(event)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe("ArenaBridge", () => {
  it("uses the configured arena origin for HTTP operations", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ sessionId: "K7P4QX" }, 201))
    const bridge = new ArenaBridge(
      "ws://localhost:6464",
      request,
      () => new MockPlayer(),
      { getOrCreate: () => "identity-token-with-enough-characters" }
    )

    await expect(bridge.createGame()).resolves.toEqual({ sessionId: "K7P4QX" })
    expect(request).toHaveBeenCalledWith("http://localhost:6464/api/sessions", { method: "POST" })
  })

  it("joins in manual mode and only submits a listed legal move", async () => {
    const player = new MockPlayer()
    let playerOptions: PlayerClientOptions | undefined
    const bridge = new ArenaBridge(
      "wss://chess.filipenos.com",
      vi.fn<typeof fetch>(),
      options => {
        playerOptions = options
        return player
      },
      { getOrCreate: () => "identity-token-with-enough-characters" }
    )

    await bridge.joinGame({
      sessionId: "K7P4QX",
      name: "Codex MCP",
      color: "white",
      agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
    })
    expect(playerOptions).toMatchObject({
      server: "wss://chess.filipenos.com",
      sessionId: "K7P4QX",
      manual: true,
      identityToken: "identity-token-with-enough-characters"
    })

    player.emit({
      type: "turn.started",
      gameId: "game-1",
      fen: "start",
      color: "white",
      ply: 0,
      legalMoves: ["e2e4"]
    })
    expect(() => bridge.playMove("K7P4QX", { from: "d2", to: "d4" })).toThrow(
      "Illegal move. Legal moves: e2e4"
    )
    expect(bridge.playMove("K7P4QX", { from: "e2", to: "e4" })).toEqual({
      submitted: "e2e4",
      expectedPly: 0
    })
    expect(player.moves).toEqual([{ command: { from: "e2", to: "e4" }, ply: 0 }])
    expect(() => bridge.playMove("K7P4QX", { from: "e2", to: "e4" })).toThrow(
      "A move is already pending confirmation"
    )
  })

  it("returns stable arena errors without exposing response internals", async () => {
    const bridge = new ArenaBridge(
      "ws://localhost:6464",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        code: "SESSION_NOT_FOUND",
        message: "Session not found"
      }, 404)),
      () => new MockPlayer(),
      { getOrCreate: () => "identity-token-with-enough-characters" }
    )

    await expect(bridge.getGame("K7P4QX")).rejects.toThrow(
      "SESSION_NOT_FOUND: Session not found"
    )
  })
})
