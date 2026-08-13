#!/usr/bin/env node
import { PlayerClient } from "@llm-chess/player-sdk"
import type { AgentMetadata, Color, ServerEvent } from "@llm-chess/protocol"
import {
  createClaudePlayer,
  createCodexPlayer,
  createOllamaPlayer,
  createOpenRouterPlayer,
  randomMove
} from "./agents.js"
import { AgentIdentityStore, ResumeStore, type ResumeIdentity } from "./resume-store.js"

interface CliOptions {
  mode: "random" | "ollama" | "codex" | "claude" | "openrouter"
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
  if (!mode || !["random", "ollama", "codex", "claude", "openrouter"].includes(mode) || !sessionId) {
    throw new Error(
      "Usage: chess-player <random|ollama|codex|claude|openrouter> <SESSION_ID> [--server ws://localhost:3001] "
      + "[--name NAME] [--seat white|black] [--model MODEL]"
    )
  }
  const seat = option(args, "--seat")
  if (seat && seat !== "white" && seat !== "black") {
    throw new Error("--seat must be white or black")
  }
  const timeout = Number(
    option(args, "--timeout")
      ?? (mode === "codex" || mode === "claude" || mode === "openrouter" ? 120_000 : 45_000)
  )
  if (!Number.isFinite(timeout) || timeout < 1_000) {
    throw new Error("--timeout must be at least 1000 milliseconds")
  }
  const model = option(args, "--model")
  if (mode === "openrouter" && !model) throw new Error("openrouter requires --model")
  return {
    mode: mode as CliOptions["mode"],
    sessionId: sessionId.toUpperCase(),
    server: option(args, "--server") ?? "ws://localhost:3001",
    name: option(args, "--name") ?? `${mode[0]?.toUpperCase()}${mode.slice(1)} Player`,
    ...(seat ? { color: seat as Color } : {}),
    ...(model ? { model } : {}),
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
  const identityToken = new AgentIdentityStore().getOrCreate({
    server: options.server,
    mode: options.mode,
    name: options.name
  })
  const agent: AgentMetadata = {
    player: options.mode === "openrouter" ? "openai-compatible" : options.mode,
    provider: options.mode === "codex" ? "openai"
      : options.mode === "claude" ? "anthropic"
        : options.mode === "openrouter" ? "openrouter"
        : options.mode === "random" ? "local" : options.mode,
    ...(options.model ? { model: options.model }
      : options.mode === "ollama" ? { model: "qwen3:8b" } : {})
  }
  const resumeStore = new ResumeStore()
  const resumeIdentity: ResumeIdentity = {
    server: options.server,
    sessionId: options.sessionId,
    mode: options.mode,
    name: options.name,
    ...(options.color ? { color: options.color } : {})
  }
  const savedSession = resumeStore.get(resumeIdentity)
  if (savedSession) process.stdout.write(`Resuming saved ${savedSession.color} seat.\n`)
  const player = new PlayerClient({
    server: options.server,
    sessionId: options.sessionId,
    name: options.name,
    type: "agent",
    identityToken,
    agent,
    ...(options.color ? { color: options.color } : {}),
    ...(savedSession ? { resumeToken: savedSession.resumeToken } : {})
  })
  player.onEvent(event => {
    logEvent(event)
    if (event.type === "connection.accepted" && event.resumeToken && event.color) {
      resumeStore.set(resumeIdentity, {
        resumeToken: event.resumeToken,
        color: event.color
      })
    }
    if (event.type === "game.finished"
      || (event.type === "session.snapshot" && event.session.status === "finished")) {
      resumeStore.delete(resumeIdentity)
      setTimeout(() => player.close(), 50)
    }
  })
  const handler = options.mode === "random" ? randomMove
    : options.mode === "ollama" ? createOllamaPlayer(options)
      : options.mode === "codex" ? createCodexPlayer(options)
        : options.mode === "claude" ? createClaudePlayer(options)
          : createOpenRouterPlayer({
              ...options,
              openRouterApiKey: process.env.OPENROUTER_API_KEY
            })
  player.onTurn(handler)

  process.once("SIGINT", () => {
    player.close()
    process.exitCode = 130
  })
  try {
    await player.connect()
  } catch (error) {
    if (savedSession && error instanceof Error && error.message.startsWith("INVALID_RESUME_TOKEN:")) {
      resumeStore.delete(resumeIdentity)
      throw new Error(
        "Saved reconnect token is no longer valid and was removed. Run the command again.",
        { cause: error }
      )
    }
    throw error
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`)
  process.exitCode = 1
})
