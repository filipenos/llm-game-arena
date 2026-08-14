import cors from "cors"
import express, { type ErrorRequestHandler } from "express"
import { leaderboardGroupSchema, sessionIdSchema } from "@llm-chess/protocol"
import type { ArenaService } from "./arena-service.js"
import { DomainError } from "./domain.js"
import { calculateLeaderboard, type RankedMatch } from "./leaderboard.js"

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

  app.get("/api/sessions", (request, response) => {
    const status = request.query.status === "waiting" || request.query.status === "ready"
      || request.query.status === "playing" || request.query.status === "finished"
      ? request.query.status
      : "finished"
    const sessions = arena.sessions.listSessions(status).map(session => {
      const snapshot = arena.sessions.snapshot(session)
      return {
        sessionId: session.id,
        gameType: session.gameType,
        status: session.status,
        whiteName: session.white?.name ?? null,
        blackName: session.black?.name ?? null,
        winner: snapshot.game?.result?.winner ?? null,
        finishReason: snapshot.game?.result?.reason ?? null,
        ply: snapshot.game?.ply ?? 0
      }
    })
    response.json({ sessions })
  })

  app.get("/api/leaderboard", (request, response) => {
    const groupResult = leaderboardGroupSchema.safeParse(request.query.groupBy ?? "model")
    const gameType = typeof request.query.gameType === "string" ? request.query.gameType : "chess"
    const requestedLimit = Number(request.query.limit ?? 20)
    if (!groupResult.success || !/^[a-z][a-z0-9-]{0,39}$/.test(gameType)
      || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      throw new DomainError("INVALID_MESSAGE", "Invalid leaderboard query")
    }
    const matches: RankedMatch[] = arena.sessions.listSessions("finished").map(session => ({
      gameType: session.gameType,
      winner: session.game?.getOutcome()?.winner ?? null,
      white: {
        identityId: session.white?.identityId,
        name: session.white?.name,
        agent: session.white?.agent
      },
      black: {
        identityId: session.black?.identityId,
        name: session.black?.name,
        agent: session.black?.agent
      }
    }))
    response.json(calculateLeaderboard(matches, gameType, groupResult.data, requestedLimit))
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
