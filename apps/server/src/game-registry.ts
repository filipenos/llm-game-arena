import type { ClientEvent, GameType } from "@llm-chess/protocol"
import type { GameActionEvent, GameAdapter } from "./game-adapter.js"
import { chessAdapter } from "./games/chess.js"
import { ticTacToeAdapter } from "./games/tic-tac-toe.js"

export type { ArenaGame, GameActionEvent } from "./game-adapter.js"

export const gameRegistry: Record<GameType, GameAdapter> = {
  chess: chessAdapter,
  "tic-tac-toe": ticTacToeAdapter
}

export function isGameAction(event: ClientEvent): event is GameActionEvent {
  return Object.values(gameRegistry).some(adapter => adapter.actionType === event.type)
}
