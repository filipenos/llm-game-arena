import { createHash, randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { tokenSchema } from "@llm-chess/protocol"

export interface AgentIdentity {
  server: string
  mode: string
  name: string
}

function normalizedServerOrigin(server: string): string {
  const endpoint = new URL(server)
  if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
    throw new Error("Player server must use ws:// or wss://")
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Player server URL must not contain credentials")
  }
  endpoint.pathname = ""
  endpoint.search = ""
  endpoint.hash = ""
  return endpoint.toString()
}

export function defaultIdentityStoreDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
): string {
  return join(
    environment.LLM_GAME_ARENA_CONFIG_DIR?.trim()
      || environment.XDG_CONFIG_HOME?.trim()
      || join(userHome, ".config"),
    "llm-game-arena",
    "agent-identities"
  )
}

export class AgentIdentityStore {
  constructor(private readonly directoryPath = defaultIdentityStoreDirectory()) {}

  getOrCreate(identity: AgentIdentity): string {
    mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 })
    chmodSync(this.directoryPath, 0o700)
    const filePath = this.recordPath(identity)
    try {
      return tokenSchema.parse(readFileSync(filePath, "utf8").trim())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    const token = Buffer.from(randomBytes(32)).toString("base64url")
    try {
      writeFileSync(filePath, `${token}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })
      chmodSync(filePath, 0o600)
      return token
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return tokenSchema.parse(readFileSync(filePath, "utf8").trim())
    }
  }

  private recordPath(identity: AgentIdentity): string {
    const key = JSON.stringify([
      normalizedServerOrigin(identity.server),
      identity.mode,
      identity.name
    ])
    return join(this.directoryPath, `${createHash("sha256").update(key).digest("hex")}.token`)
  }
}
