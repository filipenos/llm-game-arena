import type { TurnContext } from "@llm-chess/player-sdk"
import { describe, expect, it, vi } from "vitest"
import {
  createClaudePlayer,
  createCodexPlayer,
  createOpenRouterPlayer,
  parseDecisionOutput,
  reasoningSummaryFromEvent,
  runCommand,
  type AgentOptions,
  type CommandRunner
} from "./agents.js"
import { formatGameFinished } from "./messages.js"

const context: TurnContext = {
  gameId: "game",
  fen: "start",
  color: "white",
  ply: 0,
  legalMoves: ["e2e4", "d2d4"]
}

const options: AgentOptions = {
  model: "test-model",
  ollamaUrl: "http://localhost:11434",
  timeout: 10_000,
  language: "pt"
}

describe("CLI agents", () => {
  it("formats finished games in the selected language", () => {
    const result = { reason: "threefold-repetition" as const, winner: null }
    expect(formatGameFinished(result, "pt")).toBe(
      "Partida encerrada: repetição tripla; vencedor: empate."
    )
    expect(formatGameFinished(result, "en")).toBe(
      "Game finished: threefold-repetition; winner: draw."
    )
  })

  it("streams command output by line while preserving the complete result", async () => {
    const lines: string[] = []
    const output = await runCommand(process.execPath, [
      "-e", "process.stdout.write('primeira\\nsegunda')"
    ], {
      timeout: 5_000,
      onStdoutLine: line => lines.push(line)
    })

    expect(output).toBe("primeira\nsegunda")
    expect(lines).toEqual(["primeira", "segunda"])
  })

  it("parses direct and Claude structured output", () => {
    expect(parseDecisionOutput('{"move":"E2E4","memory":"Control center","commentary":"I control the center."}')).toEqual({
      move: "e2e4",
      memory: "Control center",
      commentary: "I control the center."
    })
    expect(parseDecisionOutput(JSON.stringify({
      structured_output: { move: "d2d4", memory: "Develop", commentary: "I claim space." },
      result: "ignored"
    }))).toEqual({ move: "d2d4", memory: "Develop", commentary: "I claim space." })
  })

  it("parses structured decisions and provider reasoning from JSONL", () => {
    const codexOutput = [
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "Avalio o centro." } }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: '{"move":"e2e4","memory":"Center","commentary":"Ocupo o centro."}'
        }
      })
    ].join("\n")
    expect(reasoningSummaryFromEvent(codexOutput.split("\n")[0] ?? "")).toBe(
      "Avalio o centro."
    )
    expect(parseDecisionOutput(codexOutput)).toMatchObject({
      move: "e2e4", commentary: "Ocupo o centro."
    })
    expect(reasoningSummaryFromEvent(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "Comparo os lances legais." }] }
    }))).toBe("Comparo os lances legais.")
  })

  it("invokes Codex non-interactively in a read-only sandbox", async () => {
    const onReasoning = vi.fn()
    const runner = vi.fn<CommandRunner>().mockResolvedValue(
      '{"move":"e2e4","memory":"Control the center","commentary":"I open the position."}'
    )
    const chooseMove = createCodexPlayer({ ...options, onReasoning }, runner)

    await expect(chooseMove(context)).resolves.toEqual({
      move: { from: "e2", to: "e4" }, commentary: "I open the position."
    })
    const [command, args, runOptions] = runner.mock.calls[0] ?? []
    expect(command).toBe("codex")
    expect(args).toContain("--ephemeral")
    expect(args).toContain("read-only")
    expect(args).toContain("--output-schema")
    expect(args).toContain("--json")
    expect(args).toContain("test-model")
    expect(args?.at(-1)).toBe("-")
    expect(runOptions?.input).toContain("Legal UCI moves")
    expect(runOptions?.input).toContain("Brazilian Portuguese")
    expect(onReasoning).toHaveBeenCalledWith("I open the position.")
  })

  it("invokes Claude in print mode with tools disabled", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue(JSON.stringify({
      structured_output: {
        move: "d2d4", memory: "Control the center", commentary: "I claim the center."
      },
      duration_ms: 750,
      usage: { input_tokens: 90, output_tokens: 18 }
    }))
    const chooseMove = createClaudePlayer(options, runner)

    const progress = vi.fn()
    await expect(chooseMove(context, { progress })).resolves.toEqual({
      move: { from: "d2", to: "d4" }, commentary: "I claim the center."
    })
    expect(progress).toHaveBeenCalledWith("validating", {
      attempt: 1, durationMs: 750, inputTokens: 90, outputTokens: 18
    })
    const [command, args] = runner.mock.calls[0] ?? []
    expect(command).toBe("claude")
    expect(args).toContain("-p")
    expect(args).toContain("--safe-mode")
    expect(args).toContain("--json-schema")
    expect(args).toContain("stream-json")
    expect(args).toContain("--verbose")
    expect(args).toContain("--no-session-persistence")
    const toolsIndex = args?.indexOf("--tools") ?? -1
    expect(args?.[toolsIndex + 1]).toBe("")
  })

  it("falls back to a legal move when the CLI fails", async () => {
    const runner = vi.fn<CommandRunner>().mockRejectedValue(new Error("not authenticated"))
    const chooseMove = createClaudePlayer(options, runner)

    const move = await chooseMove(context)
    expect(["e2e4", "d2d4"]).toContain(`${move.move.from}${move.move.to}`)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it("retries an invalid Codex decision with correction context", async () => {
    const runner = vi.fn<CommandRunner>()
      .mockResolvedValueOnce('{"move":"a2a3","memory":"Invalid plan","commentary":"I develop."}')
      .mockResolvedValueOnce('{"move":"e2e4","memory":"Control center","commentary":"I open the center."}')
    const chooseMove = createCodexPlayer(options, runner)

    await expect(chooseMove(context)).resolves.toEqual({
      move: { from: "e2", to: "e4" }, commentary: "I open the center."
    })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls[1]?.[2].input).toContain("Model selected an illegal move")
  })

  it("uses OpenRouter structured output with the selected model", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"move":"e2e4","memory":"Develop","commentary":"I free my bishop."}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 20 }
    }), { status: 200, headers: { "content-type": "application/json" } }))
    const chooseMove = createOpenRouterPlayer({
      ...options,
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      openRouterApiKey: "test-openrouter-key"
    }, request)

    const progress = vi.fn()
    await expect(chooseMove(context, { progress })).resolves.toEqual({
      move: { from: "e2", to: "e4" }, commentary: "I free my bishop."
    })
    expect(progress).toHaveBeenCalledWith("validating", {
      attempt: 1, inputTokens: 120, outputTokens: 20
    })
    expect(request).toHaveBeenCalledTimes(1)
    const [url, requestOptions] = request.mock.calls[0] ?? []
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(new Headers(requestOptions?.headers).get("authorization")).toBe(
      "Bearer test-openrouter-key"
    )
    const body = JSON.parse(String(requestOptions?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      provider: { require_parameters: true },
      response_format: { type: "json_schema" }
    })
  })

  it("requires an OpenRouter model and API key before connecting", () => {
    expect(() => createOpenRouterPlayer({ ...options, model: undefined })).toThrow(
      "OpenRouter requires --model"
    )
    expect(() => createOpenRouterPlayer({ ...options, model: "nvidia/test" })).toThrow(
      "OPENROUTER_API_KEY is required"
    )
  })
})
