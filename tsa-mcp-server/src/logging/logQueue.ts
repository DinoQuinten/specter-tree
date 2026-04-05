import { logger } from './logger';

/** @interface LogEntry — single buffered log entry */
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  service: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

/**
 * @class LogQueue
 * @description Buffers log entries and flushes to pino on interval or threshold.
 * Prevents synchronous logging in the MCP tool call path.
 */
export class LogQueue {
  private queue: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly flushThreshold: number = 50;

  /**
   * @param flushIntervalMs How often to flush the queue (default: 1000ms)
   */
  constructor(private readonly flushIntervalMs: number = 1000) {
    this.startFlushTimer();
  }

  /**
   * Add a log entry to the buffer. Flushes immediately if threshold is reached.
   * @param entry Log entry to buffer
   */
  push(entry: LogEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= this.flushThreshold) {
      this.flush();
    }
  }

  /**
   * Drain all buffered entries to pino immediately.
   */
  flush(): void {
    if (this.queue.length === 0) return;
    const toFlush = [...this.queue];
    this.queue = [];
    for (const entry of toFlush) {
      const { level, message, service, correlationId, context } = entry;
      logger[level]({ service, correlationId, ...context }, message);
    }
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Stop flush timer and drain remaining entries. Call on server shutdown.
   */
  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flush();
  }
}

/** Singleton LogQueue instance shared across all services */
export const logQueue = new LogQueue();
