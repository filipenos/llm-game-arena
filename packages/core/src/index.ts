export interface GameOutcome<
  TSeat extends string = string,
  TReason extends string = string
> {
  reason: TReason
  winner: TSeat | null
}

export type ActionResult<TActionRecord> =
  | { valid: true; action: TActionRecord }
  | { valid: false; reason: "game-finished" | "wrong-turn" | "invalid-action" }

export interface TurnBasedGame<
  TSeat extends string,
  TAction,
  TActionRecord,
  TPublicState,
  TPlayerState = TPublicState,
  TReason extends string = string
> {
  readonly id: string
  readonly gameType: string
  readonly seats: readonly TSeat[]

  getCurrentSeat(): TSeat
  getPublicState(): TPublicState
  getPlayerState(seat: TSeat): TPlayerState
  getLegalActions(seat: TSeat): readonly TAction[]
  submitAction(seat: TSeat, action: TAction): ActionResult<TActionRecord>
  resign(seat: TSeat): GameOutcome<TSeat, TReason> | undefined
  getHistory(): readonly TActionRecord[]
  getActionCount(): number
  isFinished(): boolean
  getOutcome(): GameOutcome<TSeat, TReason> | undefined
}

export interface GameDefinition<
  TSeat extends string,
  TAction,
  TActionRecord,
  TPublicState,
  TPlayerState = TPublicState,
  TReason extends string = string,
  TOptions = undefined
> {
  readonly gameType: string
  readonly seats: readonly TSeat[]
  create(
    id: string,
    options?: TOptions
  ): TurnBasedGame<TSeat, TAction, TActionRecord, TPublicState, TPlayerState, TReason>
}

export function defineGame<
  TSeat extends string,
  TAction,
  TActionRecord,
  TPublicState,
  TPlayerState = TPublicState,
  TReason extends string = string,
  TOptions = undefined
>(
  definition: GameDefinition<
    TSeat,
    TAction,
    TActionRecord,
    TPublicState,
    TPlayerState,
    TReason,
    TOptions
  >
): GameDefinition<TSeat, TAction, TActionRecord, TPublicState, TPlayerState, TReason, TOptions> {
  if (!definition.gameType.trim()) throw new Error("gameType must not be empty")
  if (definition.seats.length < 2) throw new Error("A game must have at least two seats")
  if (new Set(definition.seats).size !== definition.seats.length) {
    throw new Error("Game seats must be unique")
  }
  return Object.freeze({ ...definition, seats: Object.freeze([...definition.seats]) })
}
