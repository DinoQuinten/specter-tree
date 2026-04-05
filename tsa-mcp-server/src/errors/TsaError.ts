/**
 * @file TsaError.ts
 * @description Base error class for all TSA MCP server errors.
 * @module errors
 */

/**
 * @description Base error for all TSA MCP server errors. Carries a machine-readable
 * code and a structured context bag alongside the standard message.
 * @example
 * throw new TsaError('UNKNOWN_ERROR', 'Something went wrong', { detail: 'x' });
 */
export class TsaError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  /**
   * @description Creates a new TsaError.
   * @param code - Machine-readable error code used for programmatic handling.
   * @param message - Human-readable description of the error.
   * @param context - Additional key-value context forwarded to the logger.
   */
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TsaError';
    this.code = code;
    this.context = context;
  }
}
