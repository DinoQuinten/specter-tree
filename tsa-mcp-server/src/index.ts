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
import { LogEvents } from './logging/logEvents';
import { logQueue } from './logging/logQueue';

async function main(): Promise<void> {
  const env = validateEnv();

  const db = getDatabase(env.TSA_DB_PATH);
  const dbService = new DatabaseService(db);
  dbService.initialize();

  const parser = new ParserService();
  const indexer = new IndexerService(dbService, parser);
  const symbols = new SymbolService(dbService);
  const references = new ReferenceService(dbService);
  const framework = new FrameworkService(env.TSA_PROJECT_ROOT);
  const config = new ConfigService(env.TSA_PROJECT_ROOT);

  logger.info({ event: LogEvents.INDEXER_STARTED, projectRoot: env.TSA_PROJECT_ROOT });
  await indexer.scanProject(env.TSA_PROJECT_ROOT);

  const watcher = indexer.startWatcher(env.TSA_PROJECT_ROOT);

  const shutdown = async (): Promise<void> => {
    logger.info({ event: LogEvents.SERVER_SHUTDOWN });
    await watcher.close();
    logQueue.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await startServer({ db: dbService, indexer, symbols, references, framework, config });
}

main().catch(err => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err) });
  process.exit(1);
});
