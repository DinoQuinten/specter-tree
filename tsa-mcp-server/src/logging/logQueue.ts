/**
 * @file logQueue.ts
 * @description Async log queue that buffers pino writes to prevent synchronous I/O in the
 * MCP tool call path. Entries are flushed on a fixed interval or when the buffer threshold
 * is exceeded.
 * @module logging
 */
import { logger } from './logger';

/**
 * @description A single buffered log entry held in the queue before being flushed to pino.
 */
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
   * @description Creates a new LogQueue and starts the background flush timer.
   * @param flushIntervalMs - Milliseconds between automatic flushes (default: 1000).
   */
  constructor(private readonly flushIntervalMs: number = 1000) {
    this.startFlushTimer();
  }

  /**
   * @description Adds a log entry to the buffer. Triggers an immediate flush when the
   * buffer reaches the flush threshold.
   * @param entry - Log entry to buffer.
   * @returns Nothing.
   */
  push(entry: LogEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= this.flushThreshold) {
      this.flush();
    }
  }

  /**
   * @description Drains all buffered entries to pino immediately.
   * @returns Nothing.
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
   * @description Stops the flush timer and drains any remaining buffered entries.
   * Must be called during server shutdown to prevent log loss.
   * @returns A resolved promise after the final flush completes.
   */
  destroy(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flush();
    return Promise.resolve();
  }
}

/**
 * @description Singleton LogQueue instance shared across all services.
 */
export const logQueue = new LogQueue();
