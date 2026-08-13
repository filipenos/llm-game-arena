import type { TurnContext } from "@llm-chess/player-sdk"
import { describe, expect, it, vi } from "vitest"
import {
  createClaudePlayer,
  createCodexPlayer,
  parseDecisionOutput,
  type AgentOptions,
  type CommandRunner
} from "./agents.js"

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
  timeout: 10_000
}

describe("CLI agents", () => {
  it("parses direct and Claude structured output", () => {
    expect(parseDecisionOutput('{"move":"E2E4","memory":"Control center"}')).toEqual({
      move: "e2e4",
      memory: "Control center"
    })
    expect(parseDecisionOutput(JSON.stringify({
      structured_output: { move: "d2d4", memory: "Develop" },
      result: "ignored"
    }))).toEqual({ move: "d2d4", memory: "Develop" })
  })

  it("invokes Codex non-interactively in a read-only sandbox", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue(
      '{"move":"e2e4","memory":"Control the center"}'
    )
    const chooseMove = createCodexPlayer(options, runner)

    await expect(chooseMove(context)).resolves.toEqual({ from: "e2", to: "e4" })
    const [command, args, runOptions] = runner.mock.calls[0] ?? []
    expect(command).toBe("codex")
    expect(args).toContain("--ephemeral")
    expect(args).toContain("read-only")
    expect(args).toContain("--output-schema")
    expect(args).toContain("test-model")
    expect(args?.at(-1)).toBe("-")
    expect(runOptions?.input).toContain("Legal UCI moves")
  })

  it("invokes Claude in print mode with tools disabled", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue(JSON.stringify({
      structured_output: { move: "d2d4", memory: "Control the center" }
    }))
    const chooseMove = createClaudePlayer(options, runner)

    await expect(chooseMove(context)).resolves.toEqual({ from: "d2", to: "d4" })
    const [command, args] = runner.mock.calls[0] ?? []
    expect(command).toBe("claude")
    expect(args).toContain("-p")
    expect(args).toContain("--safe-mode")
    expect(args).toContain("--json-schema")
    expect(args).toContain("--no-session-persistence")
    const toolsIndex = args?.indexOf("--tools") ?? -1
    expect(args?.[toolsIndex + 1]).toBe("")
  })

  it("falls back to a legal move when the CLI fails", async () => {
    const runner = vi.fn<CommandRunner>().mockRejectedValue(new Error("not authenticated"))
    const chooseMove = createClaudePlayer(options, runner)

    const move = await chooseMove(context)
    expect(["e2e4", "d2d4"]).toContain(`${move.from}${move.to}`)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it("retries an invalid Codex decision with correction context", async () => {
    const runner = vi.fn<CommandRunner>()
      .mockResolvedValueOnce('{"move":"a2a3","memory":"Invalid plan"}')
      .mockResolvedValueOnce('{"move":"e2e4","memory":"Control center"}')
    const chooseMove = createCodexPlayer(options, runner)

    await expect(chooseMove(context)).resolves.toEqual({ from: "e2", to: "e4" })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls[1]?.[2].input).toContain("Model selected an illegal move")
  })
})
