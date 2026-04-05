import { beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { DatabaseService } from '../../src/services/DatabaseService';
import { FrameworkService } from '../../src/services/FrameworkService';
import { IndexerService } from '../../src/services/IndexerService';
import { InsightService } from '../../src/services/InsightService';
import { ParserService } from '../../src/services/ParserService';

const FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project');
const NEXT_FIXTURE = join(import.meta.dir, '../fixtures/nextjs-project');
const EXPRESS_FIXTURE = join(import.meta.dir, '../fixtures/express-project');

describe('InsightService', () => {
  let service: InsightService;
  let nextService: InsightService;

  beforeAll(async () => {
    const raw = new Database(':memory:');
    const db = new DatabaseService(raw);
    db.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(db, parser);
    await indexer.scanProject(FIXTURE);
    service = new InsightService(FIXTURE, db, new FrameworkService(FIXTURE));

    const nextRaw = new Database(':memory:');
    const nextDb = new DatabaseService(nextRaw);
    nextDb.initialize();
    const nextParser = new ParserService();
    const nextIndexer = new IndexerService(nextDb, nextParser);
    await nextIndexer.scanProject(NEXT_FIXTURE);
    nextService = new InsightService(NEXT_FIXTURE, nextDb, new FrameworkService(NEXT_FIXTURE));
  });

  it('summarizeFileStructure returns compact file anatomy', () => {
    const result = service.summarizeFileStructure({
      file_path: join(FIXTURE, 'src/auth/authService.ts')
    });

    expect(result.exports).toContain('User');
    expect(result.exports).toContain('AuthService');
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]!.name).toBe('AuthService');
    expect(result.classes[0]!.members).toEqual(['getSession', 'login', 'logout']);
    expect(result.imports_from).toHaveLength(0);
  });

  it('resolveExports follows named re-exports through a barrel file', () => {
    const result = service.resolveExports({
      file_path: join(FIXTURE, 'src/index.ts'),
      export_name: 'createUser'
    });

    expect(result).not.toBeNull();
    expect(result!.resolved_file_path.replace(/\\/g, '/')).toContain('routes/users.ts');
    expect(result!.hops.map(hop => hop.exported_as)).toContain('createUser');
  });

  it('findWriteTargets returns declaration and callers as ranked edit candidates', () => {
    const result = service.findWriteTargets({
      symbol_name: 'greetAnimal'
    });

    expect(result.targets.some(target => target.reason === 'declaration' && target.file_path.includes('animals.ts'))).toBe(true);
    expect(result.targets.some(target => target.reason === 'caller' && target.file_path.includes('utils.ts'))).toBe(true);
  });

  it('explainFlow builds a bounded outbound path from a symbol', () => {
    const result = service.explainFlow({
      symbol_name: 'makeGreeting',
      max_depth: 2
    });

    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths[0]!.hops[0]!.name).toBe('makeGreeting');
    expect(result.paths[0]!.hops.some(hop => hop.name === 'greetAnimal')).toBe(true);
  });

  it('explainFlow can start from a file path', () => {
    const result = service.explainFlow({
      file_path: join(FIXTURE, 'src/utils.ts'),
      max_depth: 1
    });

    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths.some(path => path.hops[0]!.file_path.includes('utils.ts'))).toBe(true);
  });

  it('explainFlow includes middleware hops for route entrypoints', () => {
    const result = nextService.explainFlow({
      route_path: '/api/users',
      max_depth: 2
    });

    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths[0]!.hops[0]!.kind).toBe('middleware');
    expect(result.paths[0]!.hops.some(hop => hop.file_path.includes('route.ts'))).toBe(true);
  });
});

// ── Tier 2 ────────────────────────────────────────────────────────────────────

describe('InsightService — find_write_targets scoring', () => {
  let service: InsightService;

  beforeAll(async () => {
    const raw = new Database(':memory:');
    const db = new DatabaseService(raw);
    db.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(db, parser);
    await indexer.scanProject(FIXTURE);
    service = new InsightService(FIXTURE, db, new FrameworkService(FIXTURE));
  });

  it('interface implementors are ranked at score 75', () => {
    const result = service.findWriteTargets({ symbol_name: 'Animal' });
    const impls = result.targets.filter(t => t.reason === 'implementor');
    // Dog and Cat both implement Animal
    expect(impls.length).toBeGreaterThanOrEqual(2);
    expect(impls.every(t => t.score === 75)).toBe(true);
    const implNames = impls.map(t => t.symbol_name);
    expect(implNames).toContain('Dog');
    expect(implNames).toContain('Cat');
  });

  it('declaration outranks implementors and callers', () => {
    const result = service.findWriteTargets({ symbol_name: 'Animal' });
    const decl = result.targets.find(t => t.reason === 'declaration');
    expect(decl).toBeDefined();
    expect(decl!.score).toBe(100);
    // declaration must appear first since results are sorted descending
    expect(result.targets[0]!.reason).toBe('declaration');
  });

  it('caller score (80) is between declaration (100) and implementor (75)', () => {
    const result = service.findWriteTargets({ symbol_name: 'greetAnimal' });
    const caller = result.targets.find(t => t.reason === 'caller');
    expect(caller).toBeDefined();
    expect(caller!.score).toBe(80);
  });

  it('results are sorted highest score first', () => {
    const result = service.findWriteTargets({ symbol_name: 'Animal' });
    for (let i = 0; i < result.targets.length - 1; i++) {
      expect(result.targets[i]!.score).toBeGreaterThanOrEqual(result.targets[i + 1]!.score);
    }
  });

  it('limit caps the returned target count', () => {
    const result = service.findWriteTargets({ symbol_name: 'Animal', limit: 1 });
    expect(result.targets).toHaveLength(1);
    expect(result._meta.count).toBe(1);
  });
});

describe('InsightService — explain_flow depth cap', () => {
  let service: InsightService;

  beforeAll(async () => {
    const raw = new Database(':memory:');
    const db = new DatabaseService(raw);
    db.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(db, parser);
    await indexer.scanProject(FIXTURE);
    service = new InsightService(FIXTURE, db, new FrameworkService(FIXTURE));
  });

  it('emits _warnings when requested depth exceeds the 4-hop limit', () => {
    const result = service.explainFlow({ symbol_name: 'makeGreeting', max_depth: 6 });
    expect(result._warnings).toBeDefined();
    expect(result._warnings![0]).toBe('max_depth capped at 4 (requested 6)');
  });

  it('does not emit _warnings when depth equals the limit', () => {
    const result = service.explainFlow({ symbol_name: 'makeGreeting', max_depth: 4 });
    expect(result._warnings).toBeUndefined();
  });

  it('does not emit _warnings for default depth', () => {
    const result = service.explainFlow({ symbol_name: 'makeGreeting' });
    expect(result._warnings).toBeUndefined();
  });
});

describe('InsightService — explain_flow route_path middleware ordering (Express)', () => {
  let service: InsightService;

  beforeAll(() => {
    const raw = new Database(':memory:');
    const db = new DatabaseService(raw);
    db.initialize();
    // No project scan needed — framework detection drives route_path behaviour
    service = new InsightService(EXPRESS_FIXTURE, db, new FrameworkService(EXPRESS_FIXTURE));
  });

  it('first hop is middleware, route_handler follows after all middleware', () => {
    const result = service.explainFlow({ route_path: '/api/users' });
    expect(result.paths.length).toBeGreaterThan(0);
    const hops = result.paths[0]!.hops;
    const middlewareIdx = hops.findIndex(h => h.kind === 'middleware');
    const handlerIdx = hops.findIndex(h => h.kind === 'route_handler');
    expect(middlewareIdx).toBeGreaterThanOrEqual(0);
    expect(handlerIdx).toBeGreaterThan(middlewareIdx);
  });

  it('named authMiddleware appears as a middleware hop', () => {
    const result = service.explainFlow({ route_path: '/api/users' });
    const hops = result.paths[0]!.hops;
    expect(hops.some(h => h.kind === 'middleware' && h.name === 'authMiddleware')).toBe(true);
  });

  it('route_handler hop carries the handler function name', () => {
    const result = service.explainFlow({ route_path: '/api/users' });
    const handler = result.paths[0]!.hops.find(h => h.kind === 'route_handler');
    expect(handler).toBeDefined();
    expect(handler!.name).toBe('getUsers');
  });

  it('unknown route returns empty paths without throwing', () => {
    const result = service.explainFlow({ route_path: '/api/does-not-exist' });
    expect(result.paths).toHaveLength(0);
    expect(result._meta.count).toBe(0);
  });
});
