import { ChessGame, moveToUci } from "@llm-chess/chess"
import { moveCommandSchema, type ChessMove } from "@llm-chess/protocol"
import { commonSnapshot, type ArenaGame, type GameAdapter } from "../game-adapter.js"

function chess(game: ArenaGame): ChessGame {
  if (!(game instanceof ChessGame)) throw new Error("Expected chess game")
  return game
}

export const chessAdapter: GameAdapter = {
  gameType: "chess",
  actionType: "move.play",
  create: id => new ChessGame(id),
  restore(id, moves) {
    const game = new ChessGame(id)
    for (const raw of moves) {
      const move = moveCommandSchema.parse(raw)
      if (!game.submitAction(game.getCurrentSeat(), move).valid) {
        throw new Error(`Cannot restore invalid move in game ${id}`)
      }
    }
    return game
  },
  serialize: game => chess(game).getHistory().map(move => ({
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {})
  })),
  snapshot(game, status, progress, commentaries, turnDeadlineAt) {
    const instance = chess(game)
    const moves: ChessMove[] = instance.getHistory().map((move, index) => ({
      ...move,
      ...(commentaries.get(index + 1) ? { commentary: commentaries.get(index + 1) } : {})
    }))
    return {
      ...commonSnapshot(game, status, progress, turnDeadlineAt),
      gameType: "chess",
      fen: instance.getPublicState().fen,
      moves
    }
  },
  started(game) {
    const instance = chess(game)
    return { type: "game.started", gameId: game.id, fen: instance.getPublicState().fen, turn: game.getCurrentSeat() }
  },
  turn(game, seat) {
    const instance = chess(game)
    const history = instance.getHistory()
    return {
      type: "turn.started",
      gameId: game.id,
      fen: instance.getPlayerState(seat).fen,
      color: game.getCurrentSeat(),
      ply: game.getActionCount(),
      ...(history.at(-1) ? { lastMove: history.at(-1) } : {}),
      legalMoves: instance.getLegalActions(seat).map(moveToUci)
    }
  },
  play(game, seat, event, participantId) {
    if (event.type !== "move.play") throw new Error("Wrong action for chess")
    const instance = chess(game)
    const result = instance.submitAction(seat, {
      from: event.from,
      to: event.to,
      ...(event.promotion ? { promotion: event.promotion } : {})
    })
    if (!result.valid) return { valid: false, message: "Illegal move" }
    return {
      valid: true,
      event: {
        type: "move.made",
        requestId: event.requestId,
        participantId,
        move: event.commentary ? { ...result.action, commentary: event.commentary } : result.action,
        fen: instance.getPublicState().fen,
        turn: game.getCurrentSeat(),
        ply: game.getActionCount()
      }
    }
  }
}
