import { TsaError } from './TsaError';

/**
 * @class FrameworkError
 * @description Thrown when framework detection or route/middleware tracing fails.
 */
export class FrameworkError extends TsaError {
  /**
   * @param message Description of the framework error
   * @param context Should include routePath or framework name
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('FRAMEWORK_ERROR', message, context);
    this.name = 'FrameworkError';
  }
}
