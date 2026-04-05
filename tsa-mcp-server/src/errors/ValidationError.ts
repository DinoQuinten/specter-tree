/**
 * @file ValidationError.ts
 * @description Custom error class for input validation failures, wrapping Zod or structural errors.
 * @module errors
 */
import { TsaError } from './TsaError';

/**
 * @class ValidationError
 * @description Thrown when request input fails schema validation.
 * @example
 * throw new ValidationError('VALIDATION_ERROR', 'name: Required', { fields: { name: 'Required' } });
 */
export class ValidationError extends TsaError {
  /**
   * @description Creates a new ValidationError.
   * @param code - Machine-readable error code (e.g. 'VALIDATION_ERROR').
   * @param message - Human-readable description of the validation failure.
   * @param context - Additional context including optional field-level errors.
   */
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(code, message, context);
    this.name = 'ValidationError';
  }
}
