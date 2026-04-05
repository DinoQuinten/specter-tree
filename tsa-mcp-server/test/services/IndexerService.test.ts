import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../../src/services/DatabaseService';
import { IndexerService } from '../../src/services/IndexerService';
import { ParserService } from '../../src/services/ParserService';
import { ReferenceService } from '../../src/services/ReferenceService';

describe('IndexerService', () => {
  let root: string;
  let db: Database;
  let dbService: DatabaseService;
  let indexer: IndexerService;
  let references: ReferenceService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tsa-indexer-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'dep.ts'),
      "export function greet(): string {\n  return 'hello';\n}\n"
    );
    writeFileSync(
      join(root, 'src', 'main.ts'),
      "import { greet } from './dep';\n\nexport function run(): string {\n  return greet();\n}\n"
    );

    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    indexer = new IndexerService(dbService, new ParserService());
    references = new ReferenceService(dbService);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('rebuilds inbound references when a target file is reindexed', async () => {
    await indexer.scanProject(root);

    let result = references.getCallers({ symbol_name: 'greet' });
    expect(result.results.map(entry => entry.caller_name)).toContain('run');

    writeFileSync(
      join(root, 'src', 'dep.ts'),
      "export function greet(): string {\n  return 'hello again';\n}\n"
    );

    await indexer.flushFile(join(root, 'src', 'dep.ts'));

    result = references.getCallers({ symbol_name: 'greet' });
    expect(result.results.map(entry => entry.caller_name)).toContain('run');
  });
});
