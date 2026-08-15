#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import * as z from "zod/v4"
import {
  agentMetadataSchema,
  colorSchema,
  leaderboardGroupSchema,
  moveCommandSchema,
  sessionIdSchema,
  sessionStatusSchema,
  tokenSchema
} from "@llm-chess/protocol"
import { ArenaBridge } from "./arena-bridge.js"

const serverSchema = z.string().url().startsWith("ws").optional()
const sessionArguments = z.object({
  sessionId: sessionIdSchema.describe("Six-character arena session ID"),
  server: serverSchema.describe("Arena WebSocket origin; defaults to LLM_GAME_ARENA_SERVER")
})

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: JSON.parse(JSON.stringify(data)) as Record<string, unknown>
  }
}

async function runTool(operation: () => unknown | Promise<unknown>) {
  try {
    return toolResult(await operation())
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
      }],
      isError: true
    }
  }
}

export function createArenaMcpServer(bridge = new ArenaBridge()): McpServer {
  const server = new McpServer(
    { name: "llm-game-arena", version: "0.1.0" },
    {
      instructions: "Create or join a game, then call get_player_state until turn is non-null. "
        + "Submit only a listed legal move. Call get_player_state again after every submission."
    }
  )

  server.registerTool("create_game", {
    description: "Create an arena session and return its session ID and controller token.",
    inputSchema: z.object({ server: serverSchema })
  }, ({ server: arenaServer }) => runTool(() => bridge.createGame(arenaServer)))

  server.registerTool("list_games", {
    description: "List arena sessions by status.",
    inputSchema: z.object({
      server: serverSchema,
      status: sessionStatusSchema.optional(),
      limit: z.number().int().min(1).max(100).optional()
    })
  }, options => runTool(() => bridge.listGames(options)))

  server.registerTool("get_game", {
    description: "Read the current public snapshot of an arena session.",
    inputSchema: sessionArguments
  }, ({ sessionId, server: arenaServer }) => (
    runTool(() => bridge.getGame(sessionId, arenaServer))
  ))

  server.registerTool("join_game", {
    description: "Join a seat as a manually controlled MCP agent. The player is marked ready automatically.",
    inputSchema: z.object({
      sessionId: sessionIdSchema,
      server: serverSchema,
      name: z.string().trim().min(1).max(80),
      color: colorSchema.optional(),
      agent: agentMetadataSchema
    })
  }, options => runTool(() => bridge.joinGame(options)))

  server.registerTool("get_player_state", {
    description: "Read this MCP player's color, errors, snapshot and current turn with legal moves.",
    inputSchema: sessionArguments
  }, ({ sessionId, server: arenaServer }) => (
    runTool(() => bridge.playerState(sessionId, arenaServer))
  ))

  server.registerTool("start_game", {
    description: "Start a ready game using the controller token returned by create_game.",
    inputSchema: sessionArguments.extend({ controllerToken: tokenSchema })
  }, ({ sessionId, controllerToken, server: arenaServer }) => (
    runTool(() => bridge.startGame(sessionId, controllerToken, arenaServer))
  ))

  server.registerTool("play_move", {
    description: "Submit one legal chess move for the connected MCP player.",
    inputSchema: sessionArguments.extend(moveCommandSchema.shape)
  }, ({ sessionId, server: arenaServer, from, to, promotion }) => (
    runTool(() => bridge.playMove(
      sessionId,
      { from, to, ...(promotion ? { promotion } : {}) },
      arenaServer
    ))
  ))

  server.registerTool("resign_game", {
    description: "Resign the game as the connected MCP player.",
    inputSchema: sessionArguments
  }, ({ sessionId, server: arenaServer }) => (
    runTool(() => bridge.resignGame(sessionId, arenaServer))
  ))

  server.registerTool("disconnect_player", {
    description: "Close this MCP player's in-memory connection without resigning.",
    inputSchema: sessionArguments
  }, ({ sessionId, server: arenaServer }) => (
    runTool(() => bridge.disconnect(sessionId, arenaServer))
  ))

  server.registerTool("get_leaderboard", {
    description: "Read agent rankings grouped by identity, player, provider or exact model.",
    inputSchema: z.object({
      server: serverSchema,
      gameType: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
      groupBy: leaderboardGroupSchema.optional(),
      limit: z.number().int().min(1).max(100).optional()
    })
  }, options => runTool(() => bridge.leaderboard(options)))

  return server
}

void serveStdio(() => createArenaMcpServer())
