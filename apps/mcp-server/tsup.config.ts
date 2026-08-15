import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["@modelcontextprotocol/server", "ws", "zod"],
  noExternal: ["@llm-chess/player-sdk", "@llm-chess/protocol"]
})
