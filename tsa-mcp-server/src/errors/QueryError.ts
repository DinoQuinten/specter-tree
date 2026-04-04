import { TsaError } from './TsaError';

/**
 * @class QueryError
 * @description Thrown when a bun:sqlite query fails.
 */
export class QueryError extends TsaError {
  /**
   * @param message Description of the query failure
   * @param context Should include the query and relevant parameters
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('QUERY_ERROR', message, context);
    this.name = 'QueryError';
  }
}
