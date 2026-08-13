import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  defaultResumeStoreDirectory,
  AgentIdentityStore,
  ResumeStore,
  resumeIdentityKey,
  type ResumeIdentity
} from "./resume-store.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryStore(): { directory: string; store: ResumeStore } {
  const directory = mkdtempSync(join(tmpdir(), "llm-game-arena-test-"))
  temporaryDirectories.push(directory)
  const storeDirectory = join(directory, "config", "player-sessions")
  return { directory: storeDirectory, store: new ResumeStore(storeDirectory) }
}

const identity: ResumeIdentity = {
  server: "wss://chess.filipenos.com/",
  sessionId: "K7P4QX",
  mode: "codex",
  name: "Codex Player"
}

describe("ResumeStore", () => {
  it("stores and removes a resume token without exposing it in the key", () => {
    const { directory, store } = temporaryStore()
    const resumeToken = "a-secure-resume-token-with-enough-characters"

    store.set(identity, { resumeToken, color: "black" })

    expect(store.get(identity)).toEqual({ resumeToken, color: "black" })
    expect(resumeIdentityKey(identity)).not.toContain(resumeToken)
    const [fileName] = readdirSync(directory)
    expect(fileName).toMatch(/^[a-f0-9]{64}\.json$/)
    expect(statSync(join(directory, fileName ?? "")).mode & 0o777).toBe(0o600)
    expect(statSync(directory).mode & 0o777).toBe(0o700)

    store.delete(identity)
    expect(store.get(identity)).toBeUndefined()
  })

  it("keeps sessions separate by server, mode, name and requested seat", () => {
    const { store } = temporaryStore()
    store.set(identity, {
      resumeToken: "first-secure-resume-token-with-enough-characters",
      color: "white"
    })

    expect(store.get({ ...identity, mode: "claude" })).toBeUndefined()
    expect(store.get({ ...identity, color: "black" })).toBeUndefined()
  })

  it("rejects a malformed store instead of silently discarding credentials", () => {
    const { directory, store } = temporaryStore()
    store.set(identity, {
      resumeToken: "valid-secure-resume-token-with-enough-characters",
      color: "white"
    })
    const [fileName] = readdirSync(directory)
    const filePath = join(directory, fileName ?? "")
    writeFileSync(filePath, "not-json", "utf8")

    expect(() => store.get(identity)).toThrow(`Invalid player session store at ${filePath}`)
  })

  it("supports a dedicated configuration directory", () => {
    expect(defaultResumeStoreDirectory(
      { LLM_GAME_ARENA_CONFIG_DIR: "/tmp/arena-config" },
      "/unused"
    )).toBe("/tmp/arena-config/llm-game-arena/player-sessions")
  })

  it("keeps a stable secret identity per server, mode and name", () => {
    const directory = mkdtempSync(join(tmpdir(), "llm-game-arena-identity-test-"))
    temporaryDirectories.push(directory)
    const store = new AgentIdentityStore(join(directory, "identities"))
    const first = store.getOrCreate({
      server: identity.server,
      mode: identity.mode,
      name: identity.name
    })
    const second = store.getOrCreate({
      server: identity.server,
      mode: identity.mode,
      name: identity.name
    })

    expect(second).toBe(first)
    expect(first.length).toBeGreaterThanOrEqual(24)
    const [fileName] = readdirSync(join(directory, "identities"))
    expect(fileName).not.toContain(first)
    expect(statSync(join(directory, "identities", fileName ?? "")).mode & 0o777).toBe(0o600)
  })
})
