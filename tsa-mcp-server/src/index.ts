import { validateEnv } from './types/env';
import { getDatabase } from './database/client';
import { DatabaseService } from './services/DatabaseService';
import { ParserService } from './services/ParserService';
import { IndexerService } from './services/IndexerService';
import { SymbolService } from './services/SymbolService';
import { ReferenceService } from './services/ReferenceService';
import { FrameworkService } from './services/FrameworkService';
import { ConfigService } from './services/ConfigService';
import { startServer } from './server';
import { logger } from './logging/logger';
import { logQueue } from './logging/logQueue';
import { LogEvents } from './logging/logEvents';

async function main(): Promise<void> {
  const env = validateEnv();

  const db = getDatabase(env.TSA_DB_PATH);
  const dbService = new DatabaseService(db);
  dbService.initialize();

  let watcher: ReturnType<typeof import('chokidar').watch> | undefined;

  // Shutdown gate: signal resolves this, main() awaits it, finally cleans up.
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

    logger.info({ event: LogEvents.INDEXER_STARTED, projectRoot: env.TSA_PROJECT_ROOT });
    await indexer.scanProject(env.TSA_PROJECT_ROOT);

    watcher = indexer.startWatcher(env.TSA_PROJECT_ROOT);

    await startServer({ db: dbService, indexer, symbols, references, framework, config });
    await shutdownSignal;
  } finally {
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

main().catch(err => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err) });
  process.exit(1);
});
