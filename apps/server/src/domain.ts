import type { ErrorCode } from "@llm-chess/protocol"

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly httpStatus = 400
  ) {
    super(message)
    this.name = "DomainError"
  }
}
