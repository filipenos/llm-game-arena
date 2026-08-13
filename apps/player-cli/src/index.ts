#!/usr/bin/env node
import { PlayerClient } from "@llm-chess/player-sdk"
import type { Color, ServerEvent } from "@llm-chess/protocol"
import {
  createClaudePlayer,
  createCodexPlayer,
  createOllamaPlayer,
  randomMove
} from "./agents.js"

interface CliOptions {
  mode: "random" | "ollama" | "codex" | "claude"
  sessionId: string
  server: string
  name: string
  color?: Color
  model?: string
  ollamaUrl: string
  timeout: number
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function parseArgs(args: string[]): CliOptions {
  const [mode, sessionId] = args
  if (!mode || !["random", "ollama", "codex", "claude"].includes(mode) || !sessionId) {
    throw new Error(
      "Usage: chess-player <random|ollama|codex|claude> <SESSION_ID> [--server ws://localhost:3001] "
      + "[--name NAME] [--seat white|black] [--model MODEL]"
    )
  }
  const seat = option(args, "--seat")
  if (seat && seat !== "white" && seat !== "black") {
    throw new Error("--seat must be white or black")
  }
  const timeout = Number(
    option(args, "--timeout") ?? (mode === "codex" || mode === "claude" ? 120_000 : 45_000)
  )
  if (!Number.isFinite(timeout) || timeout < 1_000) {
    throw new Error("--timeout must be at least 1000 milliseconds")
  }
  return {
    mode: mode as CliOptions["mode"],
    sessionId: sessionId.toUpperCase(),
    server: option(args, "--server") ?? "ws://localhost:3001",
    name: option(args, "--name") ?? `${mode[0]?.toUpperCase()}${mode.slice(1)} Player`,
    ...(seat ? { color: seat as Color } : {}),
    ...(option(args, "--model") ? { model: option(args, "--model") } : {}),
    ollamaUrl: option(args, "--ollama-url") ?? "http://localhost:11434",
    timeout
  }
}

function logEvent(event: ServerEvent): void {
  if (event.type === "connection.accepted") {
    process.stdout.write(`Connected as ${event.color ?? event.role}.\n`)
  } else if (event.type === "move.made") {
    process.stdout.write(`Move ${event.ply}: ${event.move.san}\n`)
  } else if (event.type === "game.finished") {
    process.stdout.write(`Game finished: ${event.result.reason}; winner: ${event.result.winner ?? "draw"}.\n`)
  } else if (event.type === "error") {
    process.stderr.write(`${event.code}: ${event.message}\n`)
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const player = new PlayerClient({
    server: options.server,
    sessionId: options.sessionId,
    name: options.name,
    type: "agent",
    ...(options.color ? { color: options.color } : {})
  })
  player.onEvent(event => {
    logEvent(event)
    if (event.type === "game.finished") {
      setTimeout(() => player.close(), 50)
    }
  })
  const handlers = {
    random: randomMove,
    ollama: createOllamaPlayer(options),
    codex: createCodexPlayer(options),
    claude: createClaudePlayer(options)
  }
  player.onTurn(handlers[options.mode])

  process.once("SIGINT", () => {
    player.close()
    process.exitCode = 130
  })
  await player.connect()
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`)
  process.exitCode = 1
})
