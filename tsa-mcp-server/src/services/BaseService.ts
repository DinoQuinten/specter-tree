/**
 * @file BaseService.ts
 * @description Abstract base class shared by all TSA services. Provides queue-based
 * structured logging helpers so every service emits consistent log entries.
 * @module services
 */
import { logQueue } from '../logging/logQueue';

/**
 * @description Abstract base for all TSA services. Provides queue-based logging helpers
 * that append structured entries to the shared log queue.
 * @class BaseService
 * @example
 * class MyService extends BaseService {
 *   constructor() { super('MyService'); }
 * }
 */
export abstract class BaseService {
  protected readonly serviceName: string;

  /**
   * @description Stores the service name that will appear in every log entry emitted
   * by this instance.
   * @param name - The service name included in every log entry.
   */
  constructor(name: string) {
    this.serviceName = name;
  }

  /**
   * @description Appends an info-level structured log entry to the shared log queue.
   * @param event - Event name from the LogEvents enum.
   * @param data - Optional structured context attached to the log entry.
   */
  protected logInfo(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'info', message: event, service: this.serviceName, context: data });
  }

  /**
   * @description Appends an error-level structured log entry to the shared log queue,
   * normalising the caught value to an Error before serialisation.
   * @param event - Event name from the LogEvents enum.
   * @param error - The error that was caught; non-Error values are wrapped.
   * @param data - Optional additional context merged into the log entry.
   */
  protected logError(event: string, error: unknown, data?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : new Error(String(error));
    logQueue.push({
      level: 'error', message: event, service: this.serviceName,
      context: { error: err.message, stack: err.stack, ...data }
    });
  }

  /**
   * @description Appends a debug-level structured log entry to the shared log queue.
   * @param event - Event name from the LogEvents enum.
   * @param data - Optional structured context attached to the log entry.
   */
  protected logDebug(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'debug', message: event, service: this.serviceName, context: data });
  }

  /**
   * @description Appends a warn-level structured log entry to the shared log queue.
   * @param event - Event name from the LogEvents enum.
   * @param data - Optional structured context attached to the log entry.
   */
  protected logWarn(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'warn', message: event, service: this.serviceName, context: data });
  }
}
