#!/usr/bin/env node
import { AgentIdentityStore, PlayerClient } from "@llm-chess/player-sdk"
import {
  sessionIdSchema,
  type AgentMetadata,
  type Color,
  type ServerEvent,
  type TokenUsage
} from "@llm-chess/protocol"
import {
  createClaudePlayer,
  createCodexPlayer,
  createOllamaPlayer,
  createOpenRouterPlayer,
  randomMove,
  type AgentLanguage
} from "./agents.js"
import { ResumeStore, type ResumeIdentity } from "./resume-store.js"
import { formatGameFinished, formatTokenUsage } from "./messages.js"

interface CliOptions {
  mode: "random" | "ollama" | "codex" | "claude" | "openrouter"
  sessionId: string
  server: string
  name: string
  color?: Color
  model?: string
  ollamaUrl: string
  timeout: number
  language: AgentLanguage
}

const PRODUCTION_SERVER = "wss://chess.filipenos.com"
const LOCAL_SERVER = "ws://localhost:6464"
const USAGE = `Usage: llm-game-arena <random|ollama|codex|claude|openrouter> <SESSION_ID> [options]

Options:
  --server URL          Arena WebSocket URL (default: ${PRODUCTION_SERVER})
  --local               Use ${LOCAL_SERVER}
  --name NAME           Player name
  --seat white|black    Request a color; omitted means automatic
  --model MODEL         Model name (required for OpenRouter)
  --language pt|en      Public output language (default: pt)
  --timeout MS          Maximum time for each model attempt
  --ollama-url URL      Ollama API URL (default: http://localhost:11434)
  --help                 Show this help
`

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function parseArgs(args: string[]): CliOptions {
  const [mode, sessionId] = args
  if (!mode || !["random", "ollama", "codex", "claude", "openrouter"].includes(mode) || !sessionId) {
    throw new Error(
      USAGE
    )
  }
  const parsedSessionId = sessionIdSchema.safeParse(sessionId.toUpperCase())
  if (!parsedSessionId.success) throw new Error("SESSION_ID must contain 6 valid letters or numbers")
  if (args.includes("--local") && args.includes("--server")) {
    throw new Error("Use either --local or --server, not both")
  }
  const seat = option(args, "--seat")
  if (seat && seat !== "white" && seat !== "black") {
    throw new Error("--seat must be white or black")
  }
  const timeout = Number(
    option(args, "--timeout")
      ?? (mode === "codex" || mode === "claude" || mode === "openrouter" ? 50_000 : 45_000)
  )
  if (!Number.isFinite(timeout) || timeout < 1_000) {
    throw new Error("--timeout must be at least 1000 milliseconds")
  }
  const model = option(args, "--model")
  if (mode === "openrouter" && !model) throw new Error("openrouter requires --model")
  const language = option(args, "--language") ?? "pt"
  if (language !== "pt" && language !== "en") {
    throw new Error("--language must be pt or en")
  }
  return {
    mode: mode as CliOptions["mode"],
    sessionId: parsedSessionId.data,
    server: args.includes("--local") ? LOCAL_SERVER : option(args, "--server") ?? PRODUCTION_SERVER,
    name: option(args, "--name") ?? `${mode[0]?.toUpperCase()}${mode.slice(1)} Player`,
    ...(seat ? { color: seat as Color } : {}),
    ...(model ? { model } : {}),
    ollamaUrl: option(args, "--ollama-url") ?? "http://localhost:11434",
    timeout,
    language
  }
}

const progressLabels: Record<AgentLanguage, Record<string, string>> = {
  pt: {
    received: "Turno recebido",
    analyzing: "Analisando",
    generating: "Consultando o modelo",
    validating: "Validando jogada",
    retrying: "Tentando novamente",
    fallback: "Usando jogada reserva",
    decided: "Jogada decidida"
  },
  en: {
    received: "Turn received",
    analyzing: "Analyzing",
    generating: "Calling model",
    validating: "Validating move",
    retrying: "Retrying",
    fallback: "Using fallback move",
    decided: "Move decided"
  }
}

function logEvent(
  event: ServerEvent,
  participantId: string | undefined,
  language: AgentLanguage,
  usage: TokenUsage
): void {
  if (event.type === "connection.accepted") {
    process.stdout.write(language === "pt" ? "Conectado.\n" : "Connected.\n")
  } else if (event.type === "move.made" && event.participantId === participantId) {
    process.stdout.write(language === "pt"
      ? `Jogada ${event.ply}: ${event.move.san}\n`
      : `Move ${event.ply}: ${event.move.san}\n`)
    if (event.move.commentary) process.stdout.write(`  ${event.move.commentary}\n`)
  } else if (event.type === "player.progress" && event.progress.participantId === participantId) {
    usage.inputTokens += event.progress.inputTokens ?? 0
    usage.outputTokens += event.progress.outputTokens ?? 0
    usage.totalTokens = usage.inputTokens + usage.outputTokens
    const metrics = [
      event.progress.attempt
        ? `${event.progress.attempt}ª` : "",
      event.progress.elapsedMs !== undefined ? compactMilliseconds(event.progress.elapsedMs) : "",
      event.progress.durationMs !== undefined
        ? `${language === "pt" ? "prov." : "provider"} ${compactMilliseconds(event.progress.durationMs)}` : "",
      event.progress.inputTokens !== undefined
        ? `↓${compactNumber(event.progress.inputTokens)}` : "",
      event.progress.outputTokens !== undefined
        ? `↑${compactNumber(event.progress.outputTokens)}` : ""
    ].filter(Boolean).join(" · ")
    process.stdout.write(
      `${progressLabels[language][event.progress.phase]}${metrics ? ` (${metrics})` : ""}\n`
    )
  } else if (event.type === "game.finished") {
    process.stdout.write(`${formatGameFinished(event.result, language)}\n`)
    process.stdout.write(`${formatTokenUsage(usage, language)}\n`)
  } else if (event.type === "error") {
    process.stderr.write(`${event.code}: ${event.message}\n`)
  }
}

function compactNumber(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Number((value / 1_000).toFixed(value < 10_000 ? 1 : 0))}k`
  return `${Number((value / 1_000_000).toFixed(1))}M`
}

function compactMilliseconds(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds}ms`
    : `${Number((milliseconds / 1_000).toFixed(1))}s`
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(USAGE)
    return
  }
  const options = parseArgs(process.argv.slice(2))
  process.stdout.write(options.language === "pt"
    ? `Entrando em ${options.sessionId} no servidor ${options.server} como ${options.mode}.\n`
    : `Joining ${options.sessionId} at ${options.server} as ${options.mode}.\n`)
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
      : options.mode === "ollama" ? { model: "qwen3:8b" }
        : options.mode === "codex" || options.mode === "claude" ? { model: "default" } : {})
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
  if (savedSession) process.stdout.write(options.language === "pt"
    ? "Retomando o assento salvo.\n"
    : "Resuming saved seat.\n")
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
  let participantId: string | undefined
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  player.onEvent(event => {
    if (event.type === "connection.accepted") participantId = event.participantId
    if (event.type === "session.snapshot" && participantId) {
      const participant = [event.session.white, event.session.black].find(
        candidate => candidate?.id === participantId
      )
      if (participant?.tokenUsage) Object.assign(usage, participant.tokenUsage)
    }
    logEvent(event, participantId, options.language, usage)
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
  const agentOptions = {
    ...options,
    onReasoning: (summary: string) => {
      process.stdout.write(`  ${options.language === "pt" ? "Análise" : "Analysis"}: ${summary}\n`)
    }
  }
  const handler = options.mode === "random"
    ? (context: Parameters<typeof randomMove>[0]) => randomMove(context, options.language)
    : options.mode === "ollama" ? createOllamaPlayer(agentOptions)
      : options.mode === "codex" ? createCodexPlayer(agentOptions)
        : options.mode === "claude" ? createClaudePlayer(agentOptions)
          : createOpenRouterPlayer({
              ...agentOptions,
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
