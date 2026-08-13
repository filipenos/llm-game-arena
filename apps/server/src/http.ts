import cors from "cors"
import express, { type ErrorRequestHandler } from "express"
import { sessionIdSchema } from "@llm-chess/protocol"
import type { ArenaService } from "./arena-service.js"
import { DomainError } from "./domain.js"

function bearerToken(value: string | undefined): string {
  const match = /^Bearer (.+)$/.exec(value ?? "")
  if (!match?.[1]) throw new DomainError("UNAUTHORIZED", "Controller token is required", 401)
  return match[1]
}

function parseSessionId(value: string | undefined): string {
  const result = sessionIdSchema.safeParse(value?.toUpperCase())
  if (!result.success) {
    throw new DomainError(
      "INVALID_SESSION_ID",
      "Session ID must have 6 valid uppercase letters or numbers",
      400
    )
  }
  return result.data
}

export function createHttpApp(arena: ArenaService) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: "16kb" }))

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  app.post("/api/sessions", (_request, response) => {
    const session = arena.sessions.createSession()
    response.status(201).json({
      sessionId: session.id,
      controllerToken: session.controllerToken
    })
  })

  app.get("/api/sessions/:sessionId", (request, response) => {
    const sessionId = parseSessionId(request.params.sessionId)
    const session = arena.sessions.getSession(sessionId)
    response.json(arena.sessions.snapshot(session))
  })

  app.post("/api/sessions/:sessionId/start", (request, response) => {
    const sessionId = parseSessionId(request.params.sessionId)
    const session = arena.startSession(sessionId, bearerToken(request.header("authorization")))
    response.json(arena.sessions.snapshot(session))
  })

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof DomainError) {
      response.status(error.httpStatus).json({ code: error.code, message: error.message })
      return
    }
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ code: "INVALID_MESSAGE", message: "Invalid request" })
      return
    }
    response.status(500).json({ code: "INTERNAL_ERROR", message: "Internal server error" })
  }
  app.use(errorHandler)
  return app
}
