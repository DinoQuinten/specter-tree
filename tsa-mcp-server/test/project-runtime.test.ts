import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '../src/runtime/ProjectRuntime';

const FIXTURE = join(import.meta.dir, 'fixtures/simple-ts-project');

describe('ProjectRuntime', () => {
  // FIXTURE is scanned once for the whole suite — beforeAll, not beforeEach.
  // Each test gets its own tempRoot and dbRoot for isolation, but pays only one FIXTURE scan.
  let runtime: ProjectRuntime;
  let sharedDbRoot: string;
  let tempRoot: string;

  beforeAll(async () => {
    sharedDbRoot = mkdtempSync(join(tmpdir(), 'tsa-runtime-db-'));
    runtime = new ProjectRuntime({
      initialProjectRoot: FIXTURE,
      dbPathOverride: join(sharedDbRoot, 'index.db')
    });
    await runtime.initialize();
  });

  afterAll(async () => {
    await runtime.shutdown();
    // Windows holds SQLite file locks briefly after close — best-effort cleanup only.
    try { rmSync(sharedDbRoot, { recursive: true, force: true }); } catch { /* EBUSY on Windows */ }
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tsa-runtime-'));
    mkdirSync(join(tempRoot, 'src'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'src', 'second.ts'),
      "export function secondProjectOnly(): string {\n  return 'ok';\n}\n"
    );
  });

  afterEach(async () => {
    // Restore FIXTURE binding so each test starts from a known root.
    await runtime.setProjectRoot(FIXTURE);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('binds the initial project root and exposes indexed services', () => {
    const result = runtime.getServices().symbols.findSymbol({ name: 'AuthService' });
    expect(runtime.getProjectRoot()).toBe(FIXTURE);
    expect(result.results.some(symbol => symbol.name === 'AuthService')).toBe(true);
  });

  it('rebinds the active project root and replaces query results', async () => {
    const switchResult = await runtime.setProjectRoot(tempRoot);

    expect(switchResult.success).toBe(true);
    expect(switchResult.project_root).toBe(tempRoot);
    expect(runtime.getProjectRoot()).toBe(tempRoot);
    expect(runtime.getServices().symbols.findSymbol({ name: 'AuthService' }).results).toHaveLength(0);
    expect(runtime.getServices().symbols.findSymbol({ name: 'secondProjectOnly' }).results).toHaveLength(1);
  });

  it('returns a no-op success when rebinding the same root', async () => {
    const first = await runtime.setProjectRoot(FIXTURE);
    const second = await runtime.setProjectRoot(FIXTURE);

    expect(first.project_root).toBe(FIXTURE);
    expect(second.success).toBe(true);
    expect(second.reindexed).toBe(false);
    expect(second.project_root).toBe(FIXTURE);
  });

  it('double rebind A→B→A: each transition replaces services and closes the previous binding', async () => {
    // A (FIXTURE) → B (tempRoot)
    await runtime.setProjectRoot(tempRoot);
    const servicesB = runtime.getServices();
    expect(servicesB.symbols.findSymbol({ name: 'secondProjectOnly' }).results).toHaveLength(1);
    expect(servicesB.symbols.findSymbol({ name: 'AuthService' }).results).toHaveLength(0);

    // B (tempRoot) → A (FIXTURE) again
    await runtime.setProjectRoot(FIXTURE);
    const servicesA2 = runtime.getServices();

    // New services should see FIXTURE symbols, not tempRoot symbols
    expect(servicesA2.symbols.findSymbol({ name: 'AuthService' }).results.length).toBeGreaterThan(0);
    expect(servicesA2.symbols.findSymbol({ name: 'secondProjectOnly' }).results).toHaveLength(0);

    // servicesB is the old binding — its db is closed, calls on it should throw or return empty
    expect(() => servicesB.symbols.findSymbol({ name: 'AuthService' })).toThrow();
  });

  it('sequential initializations each report reindexed:true', async () => {
    const b = await runtime.setProjectRoot(tempRoot);
    const a = await runtime.setProjectRoot(FIXTURE);

    expect(b.reindexed).toBe(true);
    expect(a.reindexed).toBe(true);
  });
});
