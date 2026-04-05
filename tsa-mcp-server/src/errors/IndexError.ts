/**
 * @file IndexError.ts
 * @description Error class for TypeScript file parse and indexing failures.
 * @module errors
 */
import { TsaError } from './TsaError';

/**
 * @description Thrown when ts-morph fails to parse a TypeScript file during indexing.
 * @example
 * throw new IndexError('INDEX_ERROR', 'Failed to parse file', { filePath, line });
 */
export class IndexError extends TsaError {
  /**
   * @description Creates a new IndexError.
   * @param message - Human-readable description of the parse failure.
   * @param context - Should include `filePath` and optionally the failing line number.
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INDEX_ERROR', message, context);
    this.name = 'IndexError';
  }
}
