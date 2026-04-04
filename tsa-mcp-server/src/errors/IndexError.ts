import { TsaError } from './TsaError';

/**
 * @class IndexError
 * @description Thrown when ts-morph fails to parse a TypeScript file.
 */
export class IndexError extends TsaError {
  /**
   * @param message Description of the parse failure
   * @param context Should include filePath and optionally line number
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INDEX_ERROR', message, context);
    this.name = 'IndexError';
  }
}
