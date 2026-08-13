import { randomUUID } from "node:crypto"
import type { Server } from "node:http"
import { parseClientEvent, type ServerEvent } from "@llm-chess/protocol"
import { WebSocket, WebSocketServer } from "ws"
import type { ArenaService } from "./arena-service.js"
import { DomainError } from "./domain.js"

export function attachWebSocket(server: Server, arena: ArenaService): WebSocketServer {
  const webSocketServer = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 16 * 1024
  })

  webSocketServer.on("connection", socket => {
    const connectionId = `c_${randomUUID()}`
    arena.addConnection(connectionId, {
      send(event: ServerEvent) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
      },
      close() {
        socket.close()
      }
    })

    socket.on("message", raw => {
      try {
        const json: unknown = JSON.parse(raw.toString())
        const event = parseClientEvent(json)
        void arena.handleEvent(connectionId, event)
      } catch (error) {
        const message = error instanceof SyntaxError ? "Message must be valid JSON" : "Invalid message"
        arena.sendError(connectionId, new DomainError("INVALID_MESSAGE", message))
      }
    })

    socket.on("close", () => {
      arena.removeConnection(connectionId)
    })
  })

  return webSocketServer
}
