import { TicTacToeGame } from "@llm-chess/tic-tac-toe"
import type { TicTacToeMove } from "@llm-chess/protocol"
import { commonSnapshot, type ArenaGame, type GameAdapter } from "../game-adapter.js"

function ticTacToe(game: ArenaGame): TicTacToeGame {
  if (!(game instanceof TicTacToeGame)) throw new Error("Expected tic-tac-toe game")
  return game
}

export const ticTacToeAdapter: GameAdapter = {
  gameType: "tic-tac-toe",
  actionType: "tic-tac-toe.play",
  create: id => new TicTacToeGame(id),
  restore(id, moves) {
    const game = new TicTacToeGame(id)
    for (const move of moves) {
      if (typeof move !== "number" || !game.submitAction(game.getCurrentSeat(), move).valid) {
        throw new Error(`Cannot restore invalid move in game ${id}`)
      }
    }
    return game
  },
  serialize: game => ticTacToe(game).getHistory().map(move => move.cell),
  snapshot(game, status, progress, commentaries, turnDeadlineAt) {
    const instance = ticTacToe(game)
    const moves: TicTacToeMove[] = instance.getHistory().map((move, index) => ({
      ...move,
      ...(commentaries.get(index + 1) ? { commentary: commentaries.get(index + 1) } : {})
    }))
    return {
      ...commonSnapshot(game, status, progress, turnDeadlineAt),
      gameType: "tic-tac-toe",
      board: instance.getPublicState().board,
      moves
    }
  },
  started(game) {
    return {
      type: "tic-tac-toe.started",
      gameId: game.id,
      board: ticTacToe(game).getPublicState().board,
      turn: game.getCurrentSeat()
    }
  },
  turn(game, seat) {
    const instance = ticTacToe(game)
    return {
      type: "tic-tac-toe.turn.started",
      gameId: game.id,
      board: instance.getPublicState().board,
      color: game.getCurrentSeat(),
      ply: game.getActionCount(),
      legalCells: instance.getLegalActions(seat)
    }
  },
  play(game, seat, event, participantId) {
    if (event.type !== "tic-tac-toe.play") throw new Error("Wrong action for tic-tac-toe")
    const instance = ticTacToe(game)
    const result = instance.submitAction(seat, event.cell)
    if (!result.valid) return { valid: false, message: "Cell is already occupied" }
    return {
      valid: true,
      event: {
        type: "tic-tac-toe.move.made",
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
