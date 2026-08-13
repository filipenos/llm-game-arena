import type { ClientEvent, ServerEvent } from "@llm-chess/protocol"
import { describe, expect, it } from "vitest"
import { ArenaService } from "./arena-service.js"

function eventSink(events: ServerEvent[]) {
  return { send: (event: ServerEvent) => events.push(event) }
}

describe("ArenaService", () => {
  it("runs the authoritative join, start and move flow", async () => {
    const arena = new ArenaService()
    const session = arena.sessions.createSession()
    const whiteEvents: ServerEvent[] = []
    const blackEvents: ServerEvent[] = []
    const spectatorEvents: ServerEvent[] = []
    arena.addConnection("white", eventSink(whiteEvents))
    arena.addConnection("black", eventSink(blackEvents))
    arena.addConnection("spectator", eventSink(spectatorEvents))

    await arena.handleEvent("spectator", {
      type: "connection.join",
      sessionId: session.id,
      role: "spectator"
    })
    await arena.handleEvent("white", {
      type: "connection.join",
      sessionId: session.id,
      role: "player",
      name: "White",
      participantType: "human",
      requestedColor: "white"
    })
    await arena.handleEvent("black", {
      type: "connection.join",
      sessionId: session.id,
      role: "player",
      name: "Black",
      participantType: "agent",
      requestedColor: "black"
    })
    await arena.handleEvent("white", { type: "player.ready" })
    await arena.handleEvent("black", { type: "player.ready" })
    arena.startSession(session.id, session.controllerToken)

    const turn = whiteEvents.findLast(
      (event): event is Extract<ServerEvent, { type: "turn.started" }> => event.type === "turn.started"
    )
    expect(turn?.color).toBe("white")
    expect(turn?.legalMoves).toContain("e2e4")

    await arena.handleEvent("black", {
      type: "move.play",
      requestId: "wrong-player",
      expectedPly: 0,
      from: "e7",
      to: "e5"
    })
    expect(blackEvents.at(-1)).toMatchObject({ type: "error", code: "NOT_YOUR_TURN" })

    await arena.handleEvent("white", {
      type: "move.play",
      requestId: "white-1",
      expectedPly: 0,
      from: "e2",
      to: "e4"
    })

    expect(session.game?.getActionCount()).toBe(1)
    expect(spectatorEvents.some(event => event.type === "move.made")).toBe(true)
    const snapshot = spectatorEvents.findLast(
      (event): event is Extract<ServerEvent, { type: "session.snapshot" }> => event.type === "session.snapshot"
    )
    expect(snapshot?.game?.moves[0]?.uci).toBe("e2e4")

    await arena.handleEvent("black", {
      type: "move.play",
      requestId: "stale-black",
      expectedPly: 0,
      from: "e7",
      to: "e5"
    })
    expect(blackEvents.at(-1)).toMatchObject({ type: "error", code: "STALE_PLY" })

    await arena.handleEvent("white", {
      type: "move.play",
      requestId: "white-1",
      expectedPly: 1,
      from: "d2",
      to: "d4"
    })
    expect(whiteEvents.at(-1)).toMatchObject({ type: "error", code: "DUPLICATE_REQUEST" })
  })

  it("rejects moves after resignation", async () => {
    const arena = new ArenaService()
    const session = arena.sessions.createSession()
    const whiteEvents: ServerEvent[] = []
    const blackEvents: ServerEvent[] = []
    arena.addConnection("white", eventSink(whiteEvents))
    arena.addConnection("black", eventSink(blackEvents))

    await arena.handleEvent("white", {
      type: "connection.join", sessionId: session.id, role: "player",
      name: "White", participantType: "human", requestedColor: "white"
    })
    await arena.handleEvent("black", {
      type: "connection.join", sessionId: session.id, role: "player",
      name: "Black", participantType: "human", requestedColor: "black"
    })
    await arena.handleEvent("white", { type: "player.ready" })
    await arena.handleEvent("black", { type: "player.ready" })
    arena.startSession(session.id, session.controllerToken)

    await arena.handleEvent("white", { type: "game.resign" })
    expect(session.status).toBe("finished")
    expect(session.game?.getOutcome()).toEqual({ reason: "resignation", winner: "black" })

    await arena.handleEvent("black", {
      type: "move.play",
      requestId: "after-finish",
      expectedPly: 0,
      from: "e7",
      to: "e5"
    })
    expect(blackEvents.at(-1)).toMatchObject({ type: "error", code: "GAME_NOT_PLAYING" })
  })

  it("gives a late spectator a complete mid-game snapshot", async () => {
    const arena = new ArenaService()
    const session = arena.sessions.createSession()
    const whiteEvents: ServerEvent[] = []
    const blackEvents: ServerEvent[] = []
    const spectatorEvents: ServerEvent[] = []
    arena.addConnection("white", eventSink(whiteEvents))
    arena.addConnection("black", eventSink(blackEvents))
    arena.addConnection("late-spectator", eventSink(spectatorEvents))

    await arena.handleEvent("white", {
      type: "connection.join", sessionId: session.id, role: "player",
      name: "White", participantType: "human", requestedColor: "white"
    })
    await arena.handleEvent("black", {
      type: "connection.join", sessionId: session.id, role: "player",
      name: "Black", participantType: "human", requestedColor: "black"
    })
    await arena.handleEvent("white", { type: "player.ready" })
    await arena.handleEvent("black", { type: "player.ready" })
    arena.startSession(session.id, session.controllerToken)
    await arena.handleEvent("white", {
      type: "move.play", requestId: "first-move", expectedPly: 0, from: "e2", to: "e4"
    })

    await arena.handleEvent("late-spectator", {
      type: "connection.join", sessionId: session.id, role: "spectator"
    })

    expect(spectatorEvents.at(-1)).toMatchObject({
      type: "session.snapshot",
      session: { id: session.id, status: "playing" },
      game: { ply: 1, turn: "black", moves: [{ uci: "e2e4" }] }
    })
  })

  it("finishes a headless game between two protocol clients", async () => {
    const arena = new ArenaService()
    const session = arena.sessions.createSession()
    const events = new Map<string, ServerEvent[]>([["white", []], ["black", []]])
    for (const connectionId of events.keys()) {
      arena.addConnection(connectionId, eventSink(events.get(connectionId) ?? []))
    }
    const joins: Array<[string, ClientEvent]> = [
      ["white", {
        type: "connection.join", sessionId: session.id, role: "player",
        name: "Random A", participantType: "agent", requestedColor: "white"
      }],
      ["black", {
        type: "connection.join", sessionId: session.id, role: "player",
        name: "Random B", participantType: "agent", requestedColor: "black"
      }]
    ]
    for (const [connectionId, event] of joins) await arena.handleEvent(connectionId, event)
    await arena.handleEvent("white", { type: "player.ready" })
    await arena.handleEvent("black", { type: "player.ready" })
    arena.startSession(session.id, session.controllerToken)

    for (let guard = 0; guard < 600 && session.status === "playing"; guard += 1) {
      const color = session.game?.getCurrentSeat()
      const connectionId = color === "white" ? "white" : "black"
      const turn = events.get(connectionId)?.findLast(
        (event): event is Extract<ServerEvent, { type: "turn.started" }> => event.type === "turn.started"
      )
      const uci = turn?.legalMoves[guard % turn.legalMoves.length]
      if (!turn || !uci) throw new Error("Turn context was not delivered")
      await arena.handleEvent(connectionId, {
        type: "move.play",
        requestId: `move-${guard}`,
        expectedPly: turn.ply,
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] as "q" | "r" | "b" | "n" } : {})
      })
    }

    expect(session.status).toBe("finished")
    expect(session.game?.getOutcome()).toBeDefined()
  })
})
