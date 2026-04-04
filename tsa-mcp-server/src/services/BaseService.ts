import { logQueue } from '../logging/logQueue';

/**
 * @class BaseService
 * @description Abstract base for all TSA services. Provides queue-based logging helpers.
 */
export abstract class BaseService {
  protected readonly serviceName: string;

  /**
   * @param name The service name included in every log entry
   */
  constructor(name: string) {
    this.serviceName = name;
  }

  /**
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logInfo(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'info', message: event, service: this.serviceName, context: data });
  }

  /**
   * @param event Event name from LogEvents enum
   * @param error The error that was caught
   * @param data Optional additional context
   */
  protected logError(event: string, error: unknown, data?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : new Error(String(error));
    logQueue.push({
      level: 'error', message: event, service: this.serviceName,
      context: { error: err.message, stack: err.stack, ...data }
    });
  }

  /**
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logDebug(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'debug', message: event, service: this.serviceName, context: data });
  }

  /**
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logWarn(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'warn', message: event, service: this.serviceName, context: data });
  }
}
