import { CheckersGame } from "@llm-chess/checkers"
import type { CheckersMove } from "@llm-chess/protocol"
import { commonSnapshot, type ArenaGame, type GameAdapter } from "../game-adapter.js"

function checkers(game: ArenaGame): CheckersGame {
  if (!(game instanceof CheckersGame)) throw new Error("Expected checkers game")
  return game
}

export const checkersAdapter: GameAdapter = {
  gameType: "checkers",
  actionType: "checkers.play",
  create: id => new CheckersGame(id),
  restore(id, moves) {
    const game = new CheckersGame(id)
    for (const move of moves) {
      if (!move || typeof move !== "object" || !("from" in move) || !("path" in move)
        || typeof move.from !== "number" || !Array.isArray(move.path)
        || !game.submitAction(game.getCurrentSeat(), { from: move.from, path: move.path }).valid) {
        throw new Error(`Cannot restore invalid move in game ${id}`)
      }
    }
    return game
  },
  serialize: game => checkers(game).getHistory().map(move => ({ from: move.from, path: move.path })),
  snapshot(game, status, progress, commentaries, turnDeadlineAt) {
    const instance = checkers(game)
    const moves: CheckersMove[] = instance.getHistory().map((move, index) => ({
      ...move,
      ...(commentaries.get(index + 1) ? { commentary: commentaries.get(index + 1) } : {})
    }))
    return {
      ...commonSnapshot(game, status, progress, turnDeadlineAt),
      gameType: "checkers",
      board: instance.getPublicState().board,
      moves
    }
  },
  started(game) {
    return {
      type: "checkers.started",
      gameId: game.id,
      board: checkers(game).getPublicState().board,
      turn: game.getCurrentSeat()
    }
  },
  turn(game, seat) {
    const instance = checkers(game)
    return {
      type: "checkers.turn.started",
      gameId: game.id,
      board: instance.getPublicState().board,
      color: game.getCurrentSeat(),
      ply: game.getActionCount(),
      legalMoves: instance.getLegalActions(seat)
    }
  },
  play(game, seat, event, participantId) {
    if (event.type !== "checkers.play") throw new Error("Wrong action for checkers")
    const instance = checkers(game)
    const result = instance.submitAction(seat, { from: event.from, path: event.path })
    if (!result.valid) return { valid: false, message: "Illegal checkers move" }
    return {
      valid: true,
      event: {
        type: "checkers.move.made",
        requestId: event.requestId,
        participantId,
        move: event.commentary ? { ...result.action, commentary: event.commentary } : result.action,
        board: instance.getPublicState().board,
        turn: game.getCurrentSeat(),
        ply: game.getActionCount()
      }
    }
  }
}
