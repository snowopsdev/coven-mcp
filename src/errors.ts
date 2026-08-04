export type CovenMcpErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_LIVE"
  | "DAEMON_UNAVAILABLE"
  | "INCOMPATIBLE_DAEMON"
  | "CAPABILITY_UNAVAILABLE"
  | "ROOT_NOT_ALLOWED"
  | "INVALID_RESUME_TOKEN"
  | "OUTPUT_STATE_TOO_LARGE"
  | "INVALID_INPUT"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export class CovenMcpError extends Error {
  readonly code: CovenMcpErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: CovenMcpErrorCode,
    message: string,
    retryable: boolean,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CovenMcpError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}
