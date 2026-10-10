import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const apiPort = Number(process.env.PORT ?? 6465)
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535")
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.WEB_HOST ?? "0.0.0.0",
    allowedHosts: ["userver", "userver.local"],
    port: 6464,
    strictPort: true,
    proxy: {
      "/api": `http://userver:${apiPort}`,
      "/health": `http://userver:${apiPort}`,
      "/ws": {
        target: `http://userver:${apiPort}`,
        ws: true
      }
    }
  },
  build: { outDir: "dist" }
})
