import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../src/services/DatabaseService';
import { ParserService } from '../src/services/ParserService';
import { IndexerService } from '../src/services/IndexerService';
import { SymbolService } from '../src/services/SymbolService';
import { ReferenceService } from '../src/services/ReferenceService';

const FIXTURE = join(import.meta.dir, 'fixtures/simple-ts-project');

describe('Integration: full index + query cycle', () => {
  let db: Database;
  let dbService: DatabaseService;
  let symbolService: SymbolService;
  let referenceService: ReferenceService;

  beforeAll(async () => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(dbService, parser);
    await indexer.scanProject(FIXTURE);
    symbolService = new SymbolService(dbService);
    referenceService = new ReferenceService(dbService);
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

  test('get_callers — makeGreeting calls greetAnimal (cross-file)', () => {
    const result = referenceService.getCallers({ symbol_name: 'greetAnimal' });
    expect(result.results.some(r => r.caller_name === 'makeGreeting')).toBe(true);
  });

  test('get_implementations — Dog and Cat implement Animal', () => {
    const result = referenceService.getImplementations({ interface_name: 'Animal' });
    const names = result.results.map(r => r.class_name);
    expect(names).toContain('Dog');
    expect(names).toContain('Cat');
  });

  test('get_related_files — utils.ts imports from animals.ts', () => {
    const result = referenceService.getRelatedFiles({ file_path: join(FIXTURE, 'src/utils.ts') });
    expect(result.imports_from.some((f: string) => f.includes('animals.ts'))).toBe(true);
  });
});

describe('Integration: file-level relationships', () => {
  let root: string;
  let db: Database;
  let dbService: DatabaseService;
  let referenceService: ReferenceService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'tsa-file-rel-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'setup.ts'), "export const boot = true;\n");
    writeFileSync(join(root, 'side-effect.ts'), "import './setup';\nconsole.log('boot');\n");

    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(dbService, parser);
    await indexer.scanProject(root);
    referenceService = new ReferenceService(dbService);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  test('get_related_files includes side-effect imports even when the source file declares no symbols', () => {
    const result = referenceService.getRelatedFiles({ file_path: join(root, 'side-effect.ts') });
    expect(result.imports_from).toContain(join(root, 'setup.ts'));
  });
});
