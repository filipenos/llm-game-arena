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
})
