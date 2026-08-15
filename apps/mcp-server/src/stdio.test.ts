import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { describe, expect, it } from "vitest"

describe("LLM Game Arena MCP stdio server", () => {
  it("completes the MCP handshake and lists every arena tool", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("apps/mcp-server/src/index.ts")],
      cwd: process.cwd(),
      stderr: "pipe"
    })
    const client = new Client({ name: "arena-test", version: "0.1.0" })
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map(tool => tool.name).sort()).toEqual([
        "create_game",
        "disconnect_player",
        "get_game",
        "get_leaderboard",
        "get_player_state",
        "join_game",
        "list_games",
        "play_move",
        "resign_game",
        "start_game"
      ])
    } finally {
      await client.close()
    }
  }, 15_000)
})
