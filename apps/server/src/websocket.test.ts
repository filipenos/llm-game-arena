import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket, { type RawData, type WebSocketServer } from "ws"
import type { ServerEvent } from "@llm-chess/protocol"
import { ArenaService } from "./arena-service.js"
import { attachWebSocket } from "./websocket.js"

const clients = new Set<WebSocket>()
const webSocketServers = new Set<WebSocketServer>()
const servers = new Set<ReturnType<typeof createServer>>()

afterEach(async () => {
  for (const client of clients) client.terminate()
  clients.clear()
  await Promise.all([...webSocketServers].map(webSocketServer => new Promise<void>(resolve => {
    webSocketServer.close(() => resolve())
  })))
  webSocketServers.clear()
  await Promise.all([...servers].filter(server => server.listening).map(
    server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  ))
  servers.clear()
})

async function connectClient(): Promise<WebSocket> {
  const server = createServer()
  const webSocketServer = attachWebSocket(server, new ArenaService())
  servers.add(server)
  webSocketServers.add(webSocketServer)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
  clients.add(client)
  await once(client, "open")
  return client
}

async function nextEvent(client: WebSocket): Promise<ServerEvent> {
  const [raw] = await once(client, "message") as [RawData]
  return JSON.parse(raw.toString()) as ServerEvent
}

describe("WebSocket protocol", () => {
  it("rejects malformed JSON without closing the connection", async () => {
    const client = await connectClient()
    const event = nextEvent(client)
    client.send("{")

    await expect(event).resolves.toMatchObject({
      type: "error",
      code: "INVALID_MESSAGE",
      message: "Message must be valid JSON"
    })
    expect(client.readyState).toBe(WebSocket.OPEN)
  })

  it("rejects a structurally invalid event without closing the connection", async () => {
    const client = await connectClient()
    const event = nextEvent(client)
    client.send(JSON.stringify({ type: "move.play", from: "e2", to: "e4" }))

    await expect(event).resolves.toMatchObject({
      type: "error",
      code: "INVALID_MESSAGE",
      message: "Invalid message"
    })
    expect(client.readyState).toBe(WebSocket.OPEN)
  })
})
