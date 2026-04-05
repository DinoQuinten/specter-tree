import pino from 'pino';

/**
 * @description Pino logger instance.
 * Dev: pretty-printed to stderr via pino-pretty.
 * Prod: JSON to file transports (app.log + error.log).
 * Uses stderr so stdout remains clean for MCP stdio transport.
 */
export const logger = pino(
  {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { service: 'tsa-mcp-server' }
  },
  process.env['NODE_ENV'] === 'production'
    ? pino.multistream([
        { stream: pino.destination('app.log') },
        { level: 'error', stream: pino.destination('error.log') }
      ])
    : pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, destination: 2 }
      })
);
