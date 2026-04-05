/**
 * @file FrameworkError.ts
 * @description Error class for framework detection and route/middleware tracing failures.
 * @module errors
 */
import { TsaError } from './TsaError';

/**
 * @description Thrown when framework detection or route/middleware tracing fails.
 * @example
 * throw new FrameworkError('FRAMEWORK_ERROR', 'Could not detect framework', { projectRoot });
 */
export class FrameworkError extends TsaError {
  /**
   * @description Creates a new FrameworkError.
   * @param message - Human-readable description of the failure.
   * @param context - Should include `routePath` or `framework` name for diagnostics.
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('FRAMEWORK_ERROR', message, context);
    this.name = 'FrameworkError';
  }
}
