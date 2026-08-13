import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync
} from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Color } from "@llm-chess/protocol"
import { colorSchema, sessionIdSchema, tokenSchema } from "@llm-chess/protocol"
import { z } from "zod"

const STORE_VERSION = 1

const storedSessionSchema = z.object({
  version: z.literal(STORE_VERSION),
  resumeToken: tokenSchema,
  color: colorSchema,
  updatedAt: z.string().datetime()
})

export interface ResumeIdentity {
  server: string
  sessionId: string
  mode: string
  name: string
  color?: Color
}

export interface StoredSession {
  resumeToken: string
  color: Color
}

export function defaultResumeStoreDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
): string {
  const configuredDirectory = environment.LLM_GAME_ARENA_CONFIG_DIR?.trim()
    || environment.XDG_CONFIG_HOME?.trim()
    || join(userHome, ".config")
  return join(configuredDirectory, "llm-game-arena", "player-sessions")
}

export function resumeIdentityKey(identity: ResumeIdentity): string {
  const endpoint = new URL(identity.server)
  if (!(["ws:", "wss:"] as string[]).includes(endpoint.protocol)) {
    throw new Error("Player server must use ws:// or wss://")
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Player server URL must not contain credentials")
  }
  endpoint.hash = ""
  endpoint.search = ""
  endpoint.pathname = ""
  const sessionId = sessionIdSchema.parse(identity.sessionId.toUpperCase())
  return JSON.stringify([
    endpoint.toString(),
    sessionId,
    identity.mode,
    identity.name,
    identity.color ?? "random"
  ])
}

export class ResumeStore {
  constructor(private readonly directoryPath = defaultResumeStoreDirectory()) {}

  get(identity: ResumeIdentity): StoredSession | undefined {
    const stored = this.read(identity)
    return stored ? { resumeToken: stored.resumeToken, color: stored.color } : undefined
  }

  set(identity: ResumeIdentity, session: StoredSession): void {
    this.write(identity, {
      version: STORE_VERSION,
      resumeToken: tokenSchema.parse(session.resumeToken),
      color: colorSchema.parse(session.color),
      updatedAt: new Date().toISOString()
    })
  }

  delete(identity: ResumeIdentity): void {
    rmSync(this.recordPath(identity), { force: true })
  }

  private read(identity: ResumeIdentity): z.infer<typeof storedSessionSchema> | undefined {
    const filePath = this.recordPath(identity)
    let contents: string
    try {
      contents = readFileSync(filePath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined
      }
      throw error
    }

    try {
      return storedSessionSchema.parse(JSON.parse(contents) as unknown)
    } catch (error) {
      throw new Error(`Invalid player session store at ${filePath}`, { cause: error })
    }
  }

  private write(identity: ResumeIdentity, data: z.infer<typeof storedSessionSchema>): void {
    mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 })
    chmodSync(this.directoryPath, 0o700)
    const filePath = this.recordPath(identity)
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      })
      chmodSync(temporaryPath, 0o600)
      renameSync(temporaryPath, filePath)
      chmodSync(filePath, 0o600)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  private recordPath(identity: ResumeIdentity): string {
    const digest = createHash("sha256").update(resumeIdentityKey(identity)).digest("hex")
    return join(this.directoryPath, `${digest}.json`)
  }
}
