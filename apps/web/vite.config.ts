import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const apiPort = Number(process.env.PORT ?? 6465)
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535")
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6464,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/health": `http://localhost:${apiPort}`,
      "/ws": {
        target: `http://localhost:${apiPort}`,
        ws: true
      }
    }
  },
  build: { outDir: "dist" }
})
