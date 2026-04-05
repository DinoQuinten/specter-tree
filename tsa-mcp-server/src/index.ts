/**
 * @file index.ts
 * @description Process bootstrap for the TSA MCP server. It wires core services, starts
 * indexing and transport handling, and owns graceful shutdown cleanup.
 * @module services
 */
import { validateEnv } from './types/env';
import { getDatabase } from './database/client';
import { DatabaseService } from './services/DatabaseService';
import { ParserService } from './services/ParserService';
import { IndexerService } from './services/IndexerService';
import { SymbolService } from './services/SymbolService';
import { ReferenceService } from './services/ReferenceService';
import { FrameworkService } from './services/FrameworkService';
import { ConfigService } from './services/ConfigService';
import { InsightService } from './services/InsightService';
import { startServer } from './server';
import type { TsaServer } from './server';
import { logger } from './logging/logger';
import { logQueue } from './logging/logQueue';
import { LogEvents } from './logging/logEvents';

async function main(): Promise<void> {
  const env = validateEnv();

  const db = getDatabase(env.TSA_DB_PATH);
  const dbService = new DatabaseService(db);
  dbService.initialize();

  let watcher: ReturnType<typeof import('chokidar').watch> | undefined;
  let mcpServer: TsaServer | undefined;

  // Shutdown is coordinated through a single promise so cleanup happens in one place.
  let resolveShutdown!: () => void;
  const shutdownSignal = new Promise<void>(res => { resolveShutdown = res; });
  const onSignal = (): void => {
    logger.info({ event: LogEvents.SERVER_SHUTDOWN, reason: 'signal' });
    resolveShutdown();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const parser = new ParserService();
    const indexer = new IndexerService(dbService, parser);
    const symbols = new SymbolService(dbService);
    const references = new ReferenceService(dbService);
    const framework = new FrameworkService(env.TSA_PROJECT_ROOT);
    const config = new ConfigService(env.TSA_PROJECT_ROOT);
    const insight = new InsightService(env.TSA_PROJECT_ROOT, dbService, framework);

    logger.info({ event: LogEvents.INDEXER_STARTED, projectRoot: env.TSA_PROJECT_ROOT });
    await indexer.scanProject(env.TSA_PROJECT_ROOT);

    watcher = indexer.startWatcher(env.TSA_PROJECT_ROOT);
    mcpServer = await startServer({ db: dbService, indexer, symbols, references, framework, config, insight });

    await shutdownSignal;
  } finally {
    // Drain the MCP server before closing shared resources so in-flight responses do not race cleanup.
    await mcpServer?.drain();
    await mcpServer?.server.close();
    await watcher?.close();
    await logQueue.destroy();
    db.close();
    logger.info({ event: LogEvents.SERVER_SHUTDOWN, reason: 'cleanup done' });
  }
}

process.on('uncaughtException', (err) => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err), reason: 'uncaughtException' });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(reason), reason: 'unhandledRejection' });
  process.exit(1);
});

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err) });
    process.exit(1);
  });
