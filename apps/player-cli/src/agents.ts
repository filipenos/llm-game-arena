import { execFile } from "node:child_process"
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

export interface AgentOptions {
  model?: string
  ollamaUrl: string
  timeout: number
  codexCommand?: string
  claudeCommand?: string
  openRouterApiKey?: string
}

export interface CommandRunOptions {
  timeout: number
  cwd?: string
  input?: string
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions
) => Promise<string>

export const runCommand: CommandRunner = async (command, args, options) => {
  return await new Promise<string>((resolve, reject) => {
    const child = execFile(command, args, {
      timeout: options.timeout,
      cwd: options.cwd,
      maxBuffer: 1024 * 1024,
      encoding: "utf8"
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} exited unsuccessfully`))
        return
      }
      resolve(stdout)
    })
    child.stdin?.end(options.input ?? "")
  })
}

export function randomMove(context: TurnContext): PlayerDecision {
  const uci = context.legalMoves[Math.floor(Math.random() * context.legalMoves.length)]
  const move = uci ? parseUci(uci) : undefined
  if (!move) throw new Error("No legal move is available")
  return { move, commentary: "Escolhi aleatoriamente entre as jogadas legais." }
}

function chessPrompt(context: TurnContext, memory: string, correction = ""): string {
  return [
    "You are a chess move selector. Do not inspect files or use tools.",
    `You are playing ${context.color}.`,
    `FEN: ${context.fen}`,
    `Legal UCI moves: ${context.legalMoves.join(" ")}`,
    `Previous strategic memory: ${memory || "none"}`,
    correction,
    "Choose exactly one move from the legal list.",
    "The memory is private. The commentary is public and must briefly explain the chosen move without chain-of-thought.",
    'Return {"move":"e2e4","memory":"A private plan under 500 characters","commentary":"A public summary under 240 characters"}.'
  ].filter(Boolean).join("\n")
}

function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]
  return JSON.parse((fenced ?? trimmed).trim())
}

function sanitizeCommentary(commentary: string): string {
  return [...commentary].map(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? " " : character
  }).join("").trim().slice(0, 240)
}

function outputMetrics(content: string): Pick<
  PlayerProgressMetrics,
  "durationMs" | "inputTokens" | "outputTokens"
> {
  try {
    const envelope = extractJson(content) as Record<string, unknown>
    const usage = envelope.usage && typeof envelope.usage === "object"
      ? envelope.usage as Record<string, unknown>
      : {}
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
  const envelope = extractJson(content) as Record<string, unknown>
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
    commentary: sanitizeCommentary(decision.commentary)
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
            messages: [{ role: "user", content: chessPrompt(context, memory, correction) }],
            options: { temperature: 0.2 }
          }),
          signal: AbortSignal.timeout(options.timeout)
        })
        if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
        const payload = await response.json() as {
          message?: { content?: string }
          prompt_eval_count?: number
          eval_count?: number
          total_duration?: number
        }
        reporter?.progress("validating", {
          attempt: attempt + 1,
          ...(payload.prompt_eval_count !== undefined
            ? { inputTokens: payload.prompt_eval_count } : {}),
          ...(payload.eval_count !== undefined ? { outputTokens: payload.eval_count } : {}),
          ...(payload.total_duration !== undefined
            ? { durationMs: Math.round(payload.total_duration / 1_000_000) } : {})
        })
        const decision = parseDecisionOutput(payload.message?.content ?? "")
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : "Invalid Ollama response"
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    process.stderr.write("Ollama failed twice; using a random legal move.\n")
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context)
  }
}

interface OpenRouterCompletion {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export function createOpenRouterPlayer(
  options: AgentOptions,
  request: typeof fetch = fetch
) {
  if (!options.model) throw new Error("OpenRouter requires --model")
  if (!options.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter")
  }
  let memory = ""
  return async (context: TurnContext, reporter?: TurnReporter): Promise<PlayerDecision> => {
    let correction = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        reporter?.progress("generating", { attempt: attempt + 1 })
        const response = await request("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.openRouterApiKey}`,
            "content-type": "application/json",
            "http-referer": "https://chess.filipenos.com",
            "x-openrouter-title": "LLM Game Arena"
          },
          body: JSON.stringify({
            model: options.model,
            messages: [{ role: "user", content: chessPrompt(context, memory, correction) }],
            temperature: 0.2,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "chess_decision",
                strict: true,
                schema: decisionSchema
              }
            },
            provider: { require_parameters: true }
          }),
          signal: AbortSignal.timeout(options.timeout)
        })
        if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`)
        const payload = await response.json() as OpenRouterCompletion
        reporter?.progress("validating", {
          attempt: attempt + 1,
          ...(payload.usage?.prompt_tokens !== undefined
            ? { inputTokens: payload.usage.prompt_tokens } : {}),
          ...(payload.usage?.completion_tokens !== undefined
            ? { outputTokens: payload.usage.completion_tokens } : {})
        })
        const decision = parseDecisionOutput(payload.choices?.[0]?.message?.content ?? "")
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : "Invalid OpenRouter response"
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    process.stderr.write("OpenRouter failed twice; using a random legal move.\n")
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context)
  }
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
        try {
          reporter?.progress("generating", { attempt: attempt + 1 })
          const args = [
            "exec",
            "--ephemeral",
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--output-schema", schemaPath,
            "--color", "never",
            ...(options.model ? ["--model", options.model] : []),
            "-"
          ]
          const output = await runner(options.codexCommand ?? "codex", args, {
            timeout: options.timeout,
            cwd: tempDirectory,
            input: chessPrompt(context, memory, correction)
          })
          reporter?.progress("validating", { attempt: attempt + 1 })
          const decision = parseDecisionOutput(output)
          const move = validateDecision(decision, context)
          memory = decision.memory
          return publicDecision(decision, move)
        } catch (error) {
          correction = error instanceof Error ? error.message : "Invalid Codex response"
          if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
        }
      }
      process.stderr.write("Codex failed twice; using a random legal move.\n")
      reporter?.progress("fallback", { attempt: 2 })
      return randomMove(context)
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
      try {
        reporter?.progress("generating", { attempt: attempt + 1 })
        const args = [
          "-p",
          "--safe-mode",
          "--output-format", "json",
          "--json-schema", JSON.stringify(decisionSchema),
          "--tools", "",
          "--no-session-persistence",
          ...(options.model ? ["--model", options.model] : []),
          chessPrompt(context, memory, correction)
        ]
        const output = await runner(options.claudeCommand ?? "claude", args, {
          timeout: options.timeout
        })
        reporter?.progress("validating", { attempt: attempt + 1, ...outputMetrics(output) })
        const decision = parseDecisionOutput(output)
        const move = validateDecision(decision, context)
        memory = decision.memory
        return publicDecision(decision, move)
      } catch (error) {
        correction = error instanceof Error ? error.message : "Invalid Claude response"
        if (attempt === 0) reporter?.progress("retrying", { attempt: 2 })
      }
    }
    process.stderr.write("Claude failed twice; using a random legal move.\n")
    reporter?.progress("fallback", { attempt: 2 })
    return randomMove(context)
  }
}
