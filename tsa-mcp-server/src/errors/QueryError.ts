/**
 * @file QueryError.ts
 * @description Error class for bun:sqlite query execution failures.
 * @module errors
 */
import { TsaError } from './TsaError';

/**
 * @description Thrown when a bun:sqlite query fails during execution.
 * @example
 * throw new QueryError('QUERY_ERROR', 'Failed to insert symbols', { query, params });
 */
export class QueryError extends TsaError {
  /**
   * @description Creates a new QueryError.
   * @param message - Human-readable description of the query failure.
   * @param context - Should include the SQL query string and any relevant bound parameters.
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('QUERY_ERROR', message, context);
    this.name = 'QueryError';
  }
}
