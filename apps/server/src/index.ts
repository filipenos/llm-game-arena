import { createServer } from "node:http"
import { ArenaService } from "./arena-service.js"
import { createHttpApp } from "./http.js"
import { attachWebSocket } from "./websocket.js"

const port = Number(process.env.PORT ?? 6465)
const host = process.env.API_HOST ?? "0.0.0.0"
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535")
}
const arena = new ArenaService()
const server = createServer(createHttpApp(arena))
attachWebSocket(server, arena)

server.listen(port, host, () => {
  process.stdout.write(`LLM Chess Arena server listening on http://${host}:${port}\n`)
})
