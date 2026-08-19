import { describe, expect, it } from "vitest"
import { DomainError } from "./domain.js"
import { SessionManager } from "./session-manager.js"

describe("SessionManager", () => {
  it("creates a session and assigns explicit seats", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    manager.joinPlayer(session.id, {
      connectionId: "white-connection",
      name: "White",
      type: "human",
      requestedColor: "white"
    })
    manager.joinPlayer(session.id, {
      connectionId: "black-connection",
      name: "Black",
      type: "agent",
      requestedColor: "black"
    })

    expect(session.white?.name).toBe("White")
    expect(session.black?.name).toBe("Black")
    expect(session.status).toBe("waiting")
  })

  it("rejects an occupied seat", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    manager.joinPlayer(session.id, {
      connectionId: "one",
      name: "One",
      type: "human",
      requestedColor: "white"
    })

    expect(() => manager.joinPlayer(session.id, {
      connectionId: "two",
      name: "Two",
      type: "agent",
      requestedColor: "white"
    })).toThrowError(DomainError)
  })

  it("derives a stable public identity without persisting the secret", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    const identityToken = "stable-secret-identity-token-for-codex"
    const participant = manager.joinPlayer(session.id, {
      connectionId: "codex",
      name: "Codex",
      type: "agent",
      identityToken,
      agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
    }).participant
    const persisted = manager.persistable(session)

    expect(participant.identityId).toMatch(/^agent_[a-f0-9]{64}$/)
    expect(manager.snapshot(session).session.white ?? manager.snapshot(session).session.black)
      .toMatchObject({
        identityId: participant.identityId,
        agent: { player: "codex", provider: "openai", model: "gpt-5.6-sol" }
      })
    expect(JSON.stringify(persisted)).not.toContain(identityToken)
  })

  it("assigns a random free seat and then the remaining seat", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    const first = manager.joinPlayer(session.id, {
      connectionId: "first",
      name: "First",
      type: "human"
    }).participant
    const second = manager.joinPlayer(session.id, {
      connectionId: "second",
      name: "Second",
      type: "agent"
    }).participant

    expect(["white", "black"]).toContain(first.color)
    expect(second.color).not.toBe(first.color)
    expect(session.white).toBeDefined()
    expect(session.black).toBeDefined()
  })

  it("honors an explicitly requested free seat", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    const participant = manager.joinPlayer(session.id, {
      connectionId: "black",
      name: "Black",
      type: "human",
      requestedColor: "black"
    }).participant

    expect(participant.color).toBe("black")
  })

  it("requires both players and the controller token to start", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    const white = manager.joinPlayer(session.id, {
      connectionId: "white",
      name: "White",
      type: "human",
      requestedColor: "white"
    }).participant
    const black = manager.joinPlayer(session.id, {
      connectionId: "black",
      name: "Black",
      type: "agent",
      requestedColor: "black"
    }).participant
    manager.markReady(session, white)
    manager.markReady(session, black)

    expect(session.status).toBe("ready")
    expect(() => manager.startGame(session.id, "wrong-token")).toThrowError(DomainError)
    expect(manager.startGame(session.id, session.controllerToken).status).toBe("playing")
  })

  it("reconnects only with the resume token", () => {
    const manager = new SessionManager()
    const session = manager.createSession()
    const participant = manager.joinPlayer(session.id, {
      connectionId: "old",
      name: "Player",
      type: "human"
    }).participant
    manager.disconnect("old")

    const resumed = manager.joinPlayer(session.id, {
      connectionId: "new",
      resumeToken: participant.resumeToken
    }).participant

    expect(resumed.id).toBe(participant.id)
    expect(resumed.connected).toBe(true)
    expect(resumed.connectionId).toBe("new")
  })

  it("restores a persisted in-progress session without exposing private tokens", () => {
    const manager = new SessionManager()
    const session = manager.createSession("K7P4QX")
    const white = manager.joinPlayer(session.id, {
      connectionId: "white", name: "White", type: "human", requestedColor: "white"
    }).participant
    const black = manager.joinPlayer(session.id, {
      connectionId: "black", name: "Black", type: "agent", requestedColor: "black"
    }).participant
    manager.markReady(session, white)
    manager.markReady(session, black)
    manager.startGame(session.id, session.controllerToken)
    session.game?.submitAction("white", { from: "e2", to: "e4" })
    manager.addMoveCommentary(session, 1, "Ocupo o centro.")
    manager.addProgress(session, {
      participantId: white.id,
      color: "white",
      ply: 0,
      phase: "decided",
      at: 123_000,
      elapsedMs: 900
    })
    session.turnDeadlineAt = 123_456

    const persisted = manager.persistable(session)
    const restoredManager = new SessionManager()
    const restored = restoredManager.restore(persisted)

    expect(restored.game?.getActionCount()).toBe(1)
    expect(restored.turnDeadlineAt).toBe(123_456)
    expect(restored.game?.getPublicState().fen).toBe(session.game?.getPublicState().fen)
    expect(restored.white?.connected).toBe(false)
    expect(restored.black?.connected).toBe(false)
    expect(restoredManager.snapshot(restored).game?.moves[0]?.uci).toBe("e2e4")
    expect(restoredManager.snapshot(restored).game?.moves[0]?.commentary).toBe("Ocupo o centro.")
    expect(restoredManager.snapshot(restored).game?.progress).toHaveLength(1)
    expect(JSON.stringify(restoredManager.snapshot(restored))).not.toContain(session.controllerToken)
    expect(JSON.stringify(restoredManager.snapshot(restored))).not.toContain(white.resumeToken)
  })

  it("restores an arena-enforced result", () => {
    const manager = new SessionManager()
    const session = manager.createSession("K7P4QX")
    const white = manager.joinPlayer(session.id, {
      connectionId: "white", name: "White", type: "human", requestedColor: "white"
    }).participant
    const black = manager.joinPlayer(session.id, {
      connectionId: "black", name: "Black", type: "agent", requestedColor: "black"
    }).participant
    manager.markReady(session, white)
    manager.markReady(session, black)
    manager.startGame(session.id, session.controllerToken)
    session.game?.finish({ reason: "turn-timeout", winner: "black" })
    session.status = "finished"

    const restored = new SessionManager().restore(manager.persistable(session))

    expect(restored.game?.getOutcome()).toEqual({ reason: "turn-timeout", winner: "black" })
  })
})
