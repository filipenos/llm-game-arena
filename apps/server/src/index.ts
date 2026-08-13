import { createServer } from "node:http"
import { ArenaService } from "./arena-service.js"
import { createHttpApp } from "./http.js"
import { attachWebSocket } from "./websocket.js"

const port = Number(process.env.PORT ?? 3001)
const arena = new ArenaService()
const server = createServer(createHttpApp(arena))
attachWebSocket(server, arena)

server.listen(port, () => {
  process.stdout.write(`LLM Chess Arena server listening on http://localhost:${port}\n`)
})
