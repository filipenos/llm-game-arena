import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { ArenaService } from "./arena-service.js"
import { createHttpApp } from "./http.js"

const servers = new Set<ReturnType<typeof createServer>>()

afterEach(async () => {
  await Promise.all([...servers].filter(server => server.listening).map(
    server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  ))
  servers.clear()
})

async function startHttpServer(arena: ArenaService): Promise<string> {
  const server = createServer(createHttpApp(arena))
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe("HTTP API", () => {
  it("creates, reads and starts an authorized ready session", async () => {
    const arena = new ArenaService()
    const baseUrl = await startHttpServer(arena)
    const createResponse = await fetch(`${baseUrl}/api/sessions`, { method: "POST" })
    const created = await createResponse.json() as {
      sessionId: string
      controllerToken: string
    }

    expect(createResponse.status).toBe(201)
    expect(created.sessionId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(created.controllerToken.length).toBeGreaterThanOrEqual(24)

    const getResponse = await fetch(`${baseUrl}/api/sessions/${created.sessionId}`)
    const snapshot = await getResponse.json() as Record<string, unknown>
    expect(getResponse.status).toBe(200)
    expect(JSON.stringify(snapshot)).not.toContain(created.controllerToken)

    const session = arena.sessions.getSession(created.sessionId)
    const white = arena.sessions.joinPlayer(session.id, {
      connectionId: "white", name: "White", type: "human", requestedColor: "white"
    }).participant
    const black = arena.sessions.joinPlayer(session.id, {
      connectionId: "black", name: "Black", type: "agent", requestedColor: "black"
    }).participant
    arena.sessions.markReady(session, white)
    arena.sessions.markReady(session, black)

    const unauthorizedResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/start`, {
      method: "POST"
    })
    expect(unauthorizedResponse.status).toBe(401)
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" })

    const startResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${created.controllerToken}` }
    })
    expect(startResponse.status).toBe(200)
    await expect(startResponse.json()).resolves.toMatchObject({
      session: { id: session.id, status: "playing" },
      game: { ply: 0, turn: "white" }
    })

    const listResponse = await fetch(`${baseUrl}/api/sessions?status=playing`)
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      sessions: [{ sessionId: session.id, status: "playing", whiteName: "White", blackName: "Black" }]
    })
  })

  it("returns stable errors for invalid and missing session IDs", async () => {
    const baseUrl = await startHttpServer(new ArenaService())

    const invalidResponse = await fetch(`${baseUrl}/api/sessions/123`)
    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({ code: "INVALID_SESSION_ID" })

    const missingResponse = await fetch(`${baseUrl}/api/sessions/K7P4QX`)
    expect(missingResponse.status).toBe(404)
    await expect(missingResponse.json()).resolves.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("serves model rankings from eligible finished agent matches", async () => {
    const arena = new ArenaService()
    const session = arena.sessions.createSession()
    const white = arena.sessions.joinPlayer(session.id, {
      connectionId: "codex",
      name: "Codex",
      type: "agent",
      requestedColor: "white",
      identityToken: "codex-identity-token-1234567890",
      agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
    }).participant
    const black = arena.sessions.joinPlayer(session.id, {
      connectionId: "claude",
      name: "Claude",
      type: "agent",
      requestedColor: "black",
      identityToken: "claude-identity-token-123456789",
      agent: { player: "claude", provider: "anthropic", model: "opus-5.6" }
    }).participant
    arena.sessions.markReady(session, white)
    arena.sessions.markReady(session, black)
    arena.startSession(session.id, session.controllerToken)
    session.game?.resign("black")
    session.status = "finished"

    const baseUrl = await startHttpServer(arena)
    const response = await fetch(`${baseUrl}/api/leaderboard?groupBy=model`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      gameType: "chess",
      groupBy: "model",
      eligibleGames: 1,
      entries: [
        { rank: 1, label: "gpt-5.6-sol", rating: 1216, wins: 1 },
        { rank: 2, label: "opus-5.6", rating: 1184, losses: 1 }
      ]
    })
  })

  it("rejects invalid leaderboard queries", async () => {
    const baseUrl = await startHttpServer(new ArenaService())
    const response = await fetch(`${baseUrl}/api/leaderboard?groupBy=unknown`)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_MESSAGE" })
  })
})
