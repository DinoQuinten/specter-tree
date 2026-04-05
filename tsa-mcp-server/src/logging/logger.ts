/**
 * @file logger.ts
 * @description Configures and exports the shared pino logger instance for all services.
 * In development the logger writes pretty-printed output to stderr via pino-pretty.
 * In production it writes JSON to rotating file transports (app.log + error.log).
 * stderr is used throughout so that stdout remains clean for the MCP stdio transport.
 * @module logging
 */
import pino from 'pino';

const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const rawLevel = process.env['LOG_LEVEL'] ?? '';
const logLevel = VALID_LOG_LEVELS.has(rawLevel) ? rawLevel : 'info';
const isProd = process.env['NODE_ENV'] === 'production';

/**
 * @description Singleton pino logger shared across all services and the server entry point.
 * Log level is read from the `LOG_LEVEL` environment variable, defaulting to `info`.
 */
export const logger = pino(
  {
    level: logLevel,
    base: { service: 'tsa-mcp-server' }
  },
  isProd
    ? pino.multistream([
        { stream: pino.destination({ dest: process.env['LOG_DIR'] ? `${process.env['LOG_DIR']}/app.log` : 'app.log', sync: false }) },
        { level: 'error', stream: pino.destination({ dest: process.env['LOG_DIR'] ? `${process.env['LOG_DIR']}/error.log` : 'error.log', sync: false }) }
      ])
    : pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, destination: 2 }
      })
);
