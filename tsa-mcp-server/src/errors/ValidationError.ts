import { TsaError } from './TsaError';

/**
 * @class ValidationError
 * @description Thrown when Zod fails to parse tool input arguments.
 */
export class ValidationError extends TsaError {
  /**
   * @param message Description of the validation failure
   * @param context Should include field-level errors from Zod
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', message, context);
    this.name = 'ValidationError';
  }
}
