/**
 * @class TsaError
 * @description Base error for all TSA MCP server errors.
 */
export class TsaError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  /**
   * @param code Machine-readable error code
   * @param message Human-readable description
   * @param context Additional context for logging
   */
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TsaError';
    this.code = code;
    this.context = context;
  }
}
