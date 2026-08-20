import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlayerDecision, TurnContext, TurnReporter } from "@llm-chess/player-sdk"
import { parseUci, type MoveCommand, type PlayerProgressMetrics } from "@llm-chess/protocol"

const decisionSchema = {
  type: "object",
  properties: {
    move: { type: "string", pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$" },
    memory: { type: "string", maxLength: 500 },
    commentary: { type: "string", minLength: 1, maxLength: 240 }
  },
  required: ["move", "memory", "commentary"],
  additionalProperties: false
} as const

interface Decision {
  move: string
  memory: string
  commentary: string
}

export type AgentLanguage = "pt" | "en"

export interface AgentOptions {
  model?: string
  ollamaUrl: string
  lmStudioUrl: string
  timeout: number
  codexCommand?: string
  claudeCommand?: string
  openRouterApiKey?: string
  lmStudioApiToken?: string
  language: AgentLanguage
  onReasoning?: (summary: string) => void
}

export interface CommandRunOptions {
  timeout: number
  cwd?: string
  input?: string
  onStdoutLine?: (line: string) => void
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions
) => Promise<string>

export const runCommand: CommandRunner = async (command, args, options) => {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    })
    let stdout = ""
    let pendingLine = ""
    let exceededBuffer = false
    const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeout)
    child.stdout.setEncoding("utf8")
    child.stderr.resume()
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      pendingLine += chunk
      if (stdout.length > 1024 * 1024) {
        exceededBuffer = true
        child.kill("SIGTERM")
      }
      const lines = pendingLine.split("\n")
      pendingLine = lines.pop() ?? ""
      for (const line of lines) options.onStdoutLine?.(line)
    })
    child.once("error", error => {
      clearTimeout(timeout)
      reject(new Error(`${command} could not start`, { cause: error }))
    })
    child.once("close", code => {
      clearTimeout(timeout)
      if (pendingLine) options.onStdoutLine?.(pendingLine)
      if (code !== 0 || exceededBuffer) {
        reject(new Error(`${command} exited unsuccessfully`))
        return
      }
      resolve(stdout)
    })
    child.stdin?.end(options.input ?? "")
  })
}

export function randomMove(context: TurnContext, language: AgentLanguage = "pt"): PlayerDecision {
  const uci = context.legalMoves[Math.floor(Math.random() * context.legalMoves.length)]
  const move = uci ? parseUci(uci) : undefined
  if (!move) throw new Error("No legal move is available")
  return {
    move,
    commentary: language === "pt"
      ? "Escolhi aleatoriamente entre as jogadas legais."
      : "I chose randomly from the legal moves."
  }
}

function chessPrompt(
  context: TurnContext,
  memory: string,
  language: AgentLanguage,
  correction = ""
): string {
  return [
    "You are a chess move selector. Do not inspect files or use tools.",
    `You are playing ${context.color}.`,
    `FEN: ${context.fen}`,
    `Legal UCI moves: ${context.legalMoves.join(" ")}`,
    `Previous strategic memory: ${memory || "none"}`,
    correction,
    "Choose exactly one move from the legal list.",
    language === "pt"
      ? "Write the public commentary and any user-visible reasoning summary in Brazilian Portuguese."
      : "Write the public commentary and any user-visible reasoning summary in English.",
    "The memory is private. The commentary is public and must briefly explain the chosen move without chain-of-thought.",
    'Return {"move":"e2e4","memory":"A private plan under 500 characters","commentary":"A public summary under 240 characters"}.'
  ].filter(Boolean).join("\n")
}

function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]
  return JSON.parse((fenced ?? trimmed).trim())
}

function jsonLines(content: string): Array<Record<string, unknown>> {
  return content.split("\n").flatMap(line => {
    if (!line.trim()) return []
    try {
      const parsed = JSON.parse(line) as unknown
      return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : []
    } catch {
      return []
    }
  })
}

function resultEnvelope(content: string): Record<string, unknown> {
  try {
    return extractJson(content) as Record<string, unknown>
  } catch {
    const events = jsonLines(content)
    for (const event of events.reverse()) {
      const item = event.item && typeof event.item === "object"
        ? event.item as Record<string, unknown>
        : undefined
      if (item?.type === "agent_message" && typeof item.text === "string") {
        return extractJson(item.text) as Record<string, unknown>
      }
      if (event.type === "result") return event
    }
    throw new Error("Missing structured decision")
  }
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap(part => {
    if (typeof part === "string") return [part]
    if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
      return [(part as Record<string, unknown>).text as string]
    }
    return []
  }).join(" ")
  return text || undefined
}

export function reasoningSummaryFromEvent(line: string): string | undefined {
  const [event] = jsonLines(line)
  if (!event) return undefined
  const item = event.item && typeof event.item === "object"
    ? event.item as Record<string, unknown>
    : undefined
  if (event.type === "item.completed" && item?.type === "reasoning") {
    return textValue(item.text ?? item.summary)
  }
  if (event.type !== "assistant" || !event.message || typeof event.message !== "object") {
    return undefined
  }
  const content = (event.message as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined
  const thinking = content.flatMap(block => {
    if (!block || typeof block !== "object") return []
    const typed = block as Record<string, unknown>
    return typed.type === "thinking" && typeof typed.thinking === "string"
      ? [typed.thinking]
      : []
  }).join(" ")
  return thinking || undefined
}

function sanitizeText(text: string, maxLength: number): string {
  return [...text].map(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? " " : character
  }).join("").trim().slice(0, maxLength)
}

function emitReasoning(options: AgentOptions, summary: string | undefined): boolean {
  if (!summary) return false
  const sanitized = sanitizeText(summary, 500)
  if (!sanitized || !options.onReasoning) return false
  options.onReasoning(sanitized)
  return true
}

function outputMetrics(content: string): Pick<
  PlayerProgressMetrics,
  "durationMs" | "inputTokens" | "outputTokens"
> {
  try {
    const envelope = resultEnvelope(content)
    const usageEvent = jsonLines(content).findLast(event => (
      event.usage !== undefined && typeof event.usage === "object"
    ))
    const usageValue = envelope.usage ?? usageEvent?.usage
    const usage = usageValue && typeof usageValue === "object"
      ? usageValue as Record<string, unknown> : {}
    return {
      ...(typeof envelope.duration_ms === "number"
        ? { durationMs: Math.round(envelope.duration_ms) } : {}),
      ...(typeof usage.input_tokens === "number"
        ? { inputTokens: Math.round(usage.input_tokens) } : {}),
      ...(typeof usage.output_tokens === "number"
        ? { outputTokens: Math.round(usage.output_tokens) } : {})
    }
  } catch {
    return {}
  }
}

export function parseDecisionOutput(content: string): Decision {
  const envelope = resultEnvelope(content)
  let candidate: unknown = envelope.structured_output ?? envelope
  if (typeof envelope.result === "string" && !envelope.structured_output) {
    candidate = extractJson(envelope.result)
  }
  if (!candidate || typeof candidate !== "object") throw new Error("Missing structured decision")
  const decision = candidate as Record<string, unknown>
  if (typeof decision.move !== "string" || typeof decision.memory !== "string"
    || typeof decision.commentary !== "string" || !decision.commentary.trim()) {
    throw new Error("Decision must contain move, memory and commentary strings")
  }
  return {
    move: decision.move.toLowerCase(),
    memory: decision.memory.slice(0, 500),
    commentary: sanitizeText(decision.commentary, 240)
  }
}

function validateDecision(decision: Decision, context: TurnContext): MoveCommand {
  if (!context.legalMoves.includes(decision.move)) {
    throw new Error(`Model selected an illegal move: ${decision.move}`)
  }
  const move = parseUci(decision.move)
  if (!move) throw new Error("Model returned an invalid UCI move")
  return move
}

function publicDecision(decision: Decision, move: MoveCommand): PlayerDecision {
  return { move, commentary: decision.commentary }
}

function logFallback(player: string, language: AgentLanguage): void {
  process.stderr.write(language === "pt"
    ? `${player} falhou duas vezes; usando uma jogada legal aleatória.\n`
    : `${player} failed twice; using a random legal move.\n`)
}

export function createOllamaPlayer(options: AgentOptions) {
  let memory = ""
  return async (context: TurnContext, reporter?: TurnReporter): Promise<PlayerDecision> => {
    let correction = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        reporter?.progress("generating", { attempt: attempt + 1 })
        const response = await fetch(`${options.ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: options.model ?? "qwen3:8b",
            stream: false,
            format: decisionSchema,
            messages: [{
              role: "user",
              content: chessPrompt(context, memory, options.language, correction)
            }],
            options: { temperature: 0.2 }
          }),
          signal: AbortSignal.timeout(options.timeout)
        })
        if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
        const payload = await response.json() as {
          message?: { content?: string; thinking?: string }
          prompt_eval_count?: number
          eval_count?: number
          total_duration?: number
        }
        const reasoningEmitted = emitReasoning(options, payload.message?.thinking)
        const decision = parseDecisionOutput(payload.message?.content ?? "")
        if (!reasoningEmitted) emitReasoning(options, decision.commentary)
        reporter?.progress("validating", {
          attempt: attempt + 1,
          ...(payload.prompt_eval_count !== undefined
            ? { inputTokens: payload.prompt_eval_count } : {}),
          ...(payload.eval_count !== undefined ? { outputTokens: payload.eval_count } : {}),
          ...(payload.total_duration !== undefined
            ? { durationMs: Math.round(payload.total_duration / 1_000_000) } : {})
        })
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : "Invalid Ollama response"
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    logFallback("Ollama", options.language)
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context, options.language)
  }
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string; reasoning?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface ChatCompletionPlayerConfig {
  name: string
  url: string
  headers: Record<string, string>
  extraBody?: Record<string, unknown>
}

function createChatCompletionPlayer(
  options: AgentOptions,
  config: ChatCompletionPlayerConfig,
  request: typeof fetch
) {
  let memory = ""
  return async (context: TurnContext, reporter?: TurnReporter): Promise<PlayerDecision> => {
    let correction = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        reporter?.progress("generating", { attempt: attempt + 1 })
        const response = await request(config.url, {
          method: "POST",
          headers: config.headers,
          body: JSON.stringify({
            model: options.model,
            messages: [{
              role: "user",
              content: chessPrompt(context, memory, options.language, correction)
            }],
            temperature: 0.2,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "chess_decision",
                strict: true,
                schema: decisionSchema
              }
            },
            ...config.extraBody
          }),
          signal: AbortSignal.timeout(options.timeout)
        })
        if (!response.ok) throw new Error(`${config.name} returned HTTP ${response.status}`)
        const payload = await response.json() as ChatCompletion
        const reasoningEmitted = emitReasoning(
          options,
          payload.choices?.[0]?.message?.reasoning
        )
        const decision = parseDecisionOutput(payload.choices?.[0]?.message?.content ?? "")
        if (!reasoningEmitted) emitReasoning(options, decision.commentary)
        reporter?.progress("validating", {
          attempt: attempt + 1,
          ...(payload.usage?.prompt_tokens !== undefined
            ? { inputTokens: payload.usage.prompt_tokens } : {}),
          ...(payload.usage?.completion_tokens !== undefined
            ? { outputTokens: payload.usage.completion_tokens } : {})
        })
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : `Invalid ${config.name} response`
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    logFallback(config.name, options.language)
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context, options.language)
  }
}

function httpBaseUrl(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} URL must be a valid HTTP URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} URL must use HTTP or HTTPS`)
  }
  return url.toString().replace(/\/$/, "")
}

export function createOpenRouterPlayer(
  options: AgentOptions,
  request: typeof fetch = fetch
) {
  if (!options.model) throw new Error("OpenRouter requires --model")
  if (!options.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter")
  }
  return createChatCompletionPlayer(options, {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      authorization: `Bearer ${options.openRouterApiKey}`,
      "content-type": "application/json",
      "http-referer": "https://chess.filipenos.com",
      "x-openrouter-title": "LLM Game Arena"
    },
    extraBody: { provider: { require_parameters: true } }
  }, request)
}

export function createLmStudioPlayer(
  options: AgentOptions,
  request: typeof fetch = fetch
) {
  if (!options.model) throw new Error("LM Studio requires --model")
  const baseUrl = httpBaseUrl(options.lmStudioUrl, "LM Studio")
  return createChatCompletionPlayer(options, {
    name: "LM Studio",
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "content-type": "application/json",
      ...(options.lmStudioApiToken
        ? { authorization: `Bearer ${options.lmStudioApiToken}` }
        : {})
    }
  }, request)
}

export function createCodexPlayer(options: AgentOptions, runner: CommandRunner = runCommand) {
  let memory = ""
  return async (context: TurnContext, reporter?: TurnReporter): Promise<PlayerDecision> => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "llm-chess-codex-"))
    const schemaPath = join(tempDirectory, "decision.schema.json")
    try {
      await writeFile(schemaPath, JSON.stringify(decisionSchema), { mode: 0o600 })
      let correction = ""
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let reasoningEmitted = false
        try {
          reporter?.progress("generating", { attempt: attempt + 1 })
          const args = [
            "exec",
            "--ephemeral",
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--output-schema", schemaPath,
            "--json",
            "--color", "never",
            ...(options.model ? ["--model", options.model] : []),
            "-"
          ]
          const output = await runner(options.codexCommand ?? "codex", args, {
            timeout: options.timeout,
            cwd: tempDirectory,
            input: chessPrompt(context, memory, options.language, correction),
            onStdoutLine: line => {
              reasoningEmitted = emitReasoning(options, reasoningSummaryFromEvent(line))
                || reasoningEmitted
            }
          })
          const decision = parseDecisionOutput(output)
          if (!reasoningEmitted) emitReasoning(options, decision.commentary)
          reporter?.progress("validating", { attempt: attempt + 1, ...outputMetrics(output) })
          const move = validateDecision(decision, context)
          memory = decision.memory
          return publicDecision(decision, move)
        } catch (error) {
          correction = error instanceof Error ? error.message : "Invalid Codex response"
          if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
        }
      }
      logFallback("Codex", options.language)
      reporter?.progress("fallback", { attempt: 2 })
      return randomMove(context, options.language)
    } finally {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  }
}

export function createClaudePlayer(options: AgentOptions, runner: CommandRunner = runCommand) {
  let memory = ""
  return async (context: TurnContext, reporter?: TurnReporter): Promise<PlayerDecision> => {
    let correction = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let reasoningEmitted = false
      try {
        reporter?.progress("generating", { attempt: attempt + 1 })
        const args = [
          "-p",
          "--safe-mode",
          "--output-format", "stream-json",
          "--verbose",
          "--json-schema", JSON.stringify(decisionSchema),
          "--tools", "",
          "--no-session-persistence",
          ...(options.model ? ["--model", options.model] : []),
          chessPrompt(context, memory, options.language, correction)
        ]
        const output = await runner(options.claudeCommand ?? "claude", args, {
          timeout: options.timeout,
          onStdoutLine: line => {
            reasoningEmitted = emitReasoning(options, reasoningSummaryFromEvent(line))
              || reasoningEmitted
          }
        })
        const decision = parseDecisionOutput(output)
        if (!reasoningEmitted) emitReasoning(options, decision.commentary)
        reporter?.progress("validating", { attempt: attempt + 1, ...outputMetrics(output) })
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : "Invalid Claude response"
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    logFallback("Claude", options.language)
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context, options.language)
  }
}
