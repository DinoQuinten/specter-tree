import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { DatabaseService } from '../src/services/DatabaseService';
import { ParserService } from '../src/services/ParserService';
import { IndexerService } from '../src/services/IndexerService';
import { SymbolService } from '../src/services/SymbolService';

const FIXTURE = join(import.meta.dir, 'fixtures/simple-ts-project');

describe('Integration: full index + query cycle', () => {
  let db: Database;
  let dbService: DatabaseService;
  let symbolService: SymbolService;

  beforeAll(async () => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(dbService, parser);
    await indexer.scanProject(FIXTURE);
    symbolService = new SymbolService(dbService);
  });

  afterAll(() => db.close());

  test('find_symbol locates AuthService class', () => {
    const result = symbolService.findSymbol({ name: 'AuthService' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.kind).toBe('class');
    expect(result.results[0]!.file_path).toContain('authService.ts');
  });

  test('search_symbols finds functions by partial name', () => {
    const result = symbolService.searchSymbols({ query: 'User' });
    expect(result.results.some(r => r.name === 'getUsers')).toBe(true);
  });

  test('get_methods returns AuthService methods', () => {
    const result = symbolService.getMethods({ class_name: 'AuthService' });
    expect(result.results.some(m => m.name === 'login')).toBe(true);
    expect(result.results.some(m => m.name === 'logout')).toBe(true);
  });

  test('get_file_symbols returns symbols for authService.ts', () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    const result = symbolService.getFileSymbols({ file_path: filePath });
    expect(result.results.some(s => s.name === 'AuthService')).toBe(true);
  });

  test('_meta includes count and query_ms', () => {
    const result = symbolService.findSymbol({ name: 'AuthService' });
    expect(result._meta.count).toBe(1);
    expect(result._meta.query_ms).toBeGreaterThanOrEqual(0);
    expect(result._meta.correlationId).toBeDefined();
  });
});
