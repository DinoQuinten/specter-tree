# TSA Reference Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the references table with `imports`, `extends`, `implements`, and `calls` edges so that `get_callers`, `get_related_files`, `get_hierarchy`, and `get_implementations` return real results.

**Architecture:** Four changes: (1) add `NamedRef` type and three new `DatabaseService` methods, (2) rewrite `ParserService.extractReferences` to return `NamedRef[]` with import-map-based file resolution and call-graph extraction, (3) wire both into `IndexerService` with a two-pass `scanProject`, (4) verify with an updated integration test. The two-pass strategy (all symbols first, then all refs) solves the cross-file chicken-and-egg problem on initial scan. Incremental updates (single file change) re-extract only the changed file's refs — a known acceptable limitation.

**Tech Stack:** Bun runtime, bun:sqlite, ts-morph (SyntaxKind.CallExpression), existing service patterns.

**Spec:** `docs/superpowers/specs/2026-04-04-tsa-reference-extraction-design.md`

---

## File Map

```
tsa-mcp-server/
  src/
    types/
      common.ts              MODIFY — add NamedRef interface
    services/
      DatabaseService.ts     MODIFY — add getAllSymbolNames, deleteFileReferences, resolveAndInsertNamedRefs
      ParserService.ts       MODIFY — rewrite extractReferences, add buildImportMap, resolveImportPath, getCalleeName, getEnclosingName
      IndexerService.ts      MODIFY — two-pass scanProject, wire refs into reindexFile
  test/
    services/
      DatabaseService.test.ts   MODIFY — add tests for 3 new methods
      ParserService.test.ts     MODIFY — add tests for new extractReferences
    integration.test.ts         MODIFY — test get_callers cross-file
```

---

### Task 1: NamedRef type + DatabaseService methods

**Files:**
- Modify: `src/types/common.ts`
- Modify: `src/services/DatabaseService.ts`
- Modify: `test/services/DatabaseService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/services/DatabaseService.test.ts` after the existing tests:

```typescript
import type { NamedRef } from '../../src/types/common';

describe('DatabaseService — reference methods', () => {
  let svc: DatabaseService;

  beforeEach(() => {
    svc = makeDb();
    svc.insertSymbols([
      BASE_SYMBOL,
      { ...BASE_SYMBOL, name: 'callerFn', kind: 'function' as const, file_path: '/proj/src/caller.ts' },
      { ...BASE_SYMBOL, name: 'Animal', kind: 'interface' as const, file_path: '/proj/src/animal.ts' }
    ]);
  });

  it('getAllSymbolNames returns all symbol names as a Set', () => {
    const names = svc.getAllSymbolNames();
    expect(names.has('TestClass')).toBe(true);
    expect(names.has('callerFn')).toBe(true);
    expect(names instanceof Set).toBe(true);
  });

  it('resolveAndInsertNamedRefs inserts ref when both symbols resolve', () => {
    const ref: NamedRef = {
      sourceName: 'callerFn', sourceFile: '/proj/src/caller.ts',
      targetName: 'TestClass', targetFile: '/proj/src/test.ts',
      ref_kind: 'calls', source_line: 5, confidence: 'direct'
    };
    svc.resolveAndInsertNamedRefs([ref]);
    const target = svc.querySymbolsByName('TestClass')[0]!;
    const callers = svc.getCallers(target.id);
    expect(callers).toHaveLength(1);
    expect(callers[0]!.caller_name).toBe('callerFn');
  });

  it('resolveAndInsertNamedRefs skips ref when source not found', () => {
    const ref: NamedRef = {
      sourceName: 'ghostFn', sourceFile: '/proj/src/caller.ts',
      targetName: 'TestClass', targetFile: '/proj/src/test.ts',
      ref_kind: 'calls', source_line: 1, confidence: 'direct'
    };
    svc.resolveAndInsertNamedRefs([ref]);
    const target = svc.querySymbolsByName('TestClass')[0]!;
    expect(svc.getCallers(target.id)).toHaveLength(0);
  });

  it('resolveAndInsertNamedRefs resolves by name-only when targetFile is null', () => {
    const ref: NamedRef = {
      sourceName: 'callerFn', sourceFile: '/proj/src/caller.ts',
      targetName: 'TestClass', targetFile: null,
      ref_kind: 'calls', source_line: 5, confidence: 'direct'
    };
    svc.resolveAndInsertNamedRefs([ref]);
    const target = svc.querySymbolsByName('TestClass')[0]!;
    expect(svc.getCallers(target.id)).toHaveLength(1);
  });

  it('resolveAndInsertNamedRefs resolves source by file-only when sourceName is <file>', () => {
    const ref: NamedRef = {
      sourceName: '<file>', sourceFile: '/proj/src/caller.ts',
      targetName: 'TestClass', targetFile: '/proj/src/test.ts',
      ref_kind: 'imports', source_line: 1, confidence: 'direct'
    };
    svc.resolveAndInsertNamedRefs([ref]);
    const related = svc.getRelatedFiles('/proj/src/caller.ts');
    expect(related.imports_from).toContain('/proj/src/test.ts');
  });

  it('deleteFileReferences removes only refs whose source symbols are in the file', () => {
    const ref: NamedRef = {
      sourceName: 'callerFn', sourceFile: '/proj/src/caller.ts',
      targetName: 'TestClass', targetFile: '/proj/src/test.ts',
      ref_kind: 'calls', source_line: 5, confidence: 'direct'
    };
    svc.resolveAndInsertNamedRefs([ref]);
    svc.deleteFileReferences('/proj/src/caller.ts');
    const target = svc.querySymbolsByName('TestClass')[0]!;
    expect(svc.getCallers(target.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tsa-mcp-server && bun test test/services/DatabaseService.test.ts
```

Expected: FAIL — `NamedRef` not found, `getAllSymbolNames`/`resolveAndInsertNamedRefs`/`deleteFileReferences` not defined.

- [ ] **Step 3: Add `NamedRef` to `src/types/common.ts`**

Add after the `ToolError` interface (end of file):

```typescript
/**
 * A named reference before DB ID resolution.
 * sourceName='<file>' means: use any symbol from sourceFile as the source anchor.
 */
export interface NamedRef {
  sourceName: string;
  sourceFile: string;
  targetName: string;
  targetFile: string | null;
  ref_kind: 'calls' | 'imports' | 'extends' | 'implements';
  source_line: number | null;
  confidence: 'direct' | 'inferred' | 'weak';
}
```

- [ ] **Step 4: Add three methods to `src/services/DatabaseService.ts`**

Add the import of `NamedRef` at the top — change the existing import line:

```typescript
import type { TsaSymbol, TsaReference, FileRecord, NamedRef } from '../types/common';
```

Add these three methods after `getAllFilePaths()`:

```typescript
/**
 * Get all distinct symbol names in the index. Used to filter call graph extraction
 * to project-defined symbols only.
 * @returns Set of all symbol names
 */
getAllSymbolNames(): Set<string> {
  try {
    const rows = this.db.query('SELECT DISTINCT name FROM symbols').all() as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch (err) {
    throw new QueryError('Failed to get all symbol names', { cause: String(err) });
  }
}

/**
 * Delete all references whose source symbol belongs to the given file.
 * Called before re-extracting refs for a file on incremental update.
 * Note: deleteFileSymbols already cascades, so this is only needed when
 * refreshing refs without refreshing symbols.
 * @param filePath File whose outgoing refs to delete
 */
deleteFileReferences(filePath: string): void {
  try {
    this.db.run(`
      DELETE FROM "references" WHERE source_symbol_id IN (
        SELECT id FROM symbols WHERE file_path = ?
      )
    `, [filePath]);
  } catch (err) {
    throw new QueryError('Failed to delete file references', { cause: String(err), filePath });
  }
}

/**
 * Resolve NamedRef[] to symbol IDs and insert into the references table.
 * Skips any ref where source or target cannot be resolved.
 * sourceName='<file>' resolves to any symbol in sourceFile (for import edges).
 * targetFile present → resolve by (name, file_path); absent → resolve by name only.
 * @param refs Named references to resolve and insert
 */
resolveAndInsertNamedRefs(refs: NamedRef[]): void {
  if (refs.length === 0) return;
  const stmt = this.db.prepare(`
    INSERT OR IGNORE INTO "references" (source_symbol_id, target_symbol_id, ref_kind, source_line, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = this.db.transaction((namedRefs: NamedRef[]) => {
    for (const ref of namedRefs) {
      const source = ref.sourceName === '<file>'
        ? this.db.query('SELECT id FROM symbols WHERE file_path = ? LIMIT 1').get(ref.sourceFile) as { id: number } | null
        : this.db.query('SELECT id FROM symbols WHERE name = ? AND file_path = ?').get(ref.sourceName, ref.sourceFile) as { id: number } | null;
      if (!source) continue;

      const target = ref.targetFile
        ? this.db.query('SELECT id FROM symbols WHERE name = ? AND file_path = ?').get(ref.targetName, ref.targetFile) as { id: number } | null
        : this.db.query('SELECT id FROM symbols WHERE name = ? LIMIT 1').get(ref.targetName) as { id: number } | null;
      if (!target) continue;

      stmt.run(source.id, target.id, ref.ref_kind, ref.source_line, ref.confidence);
    }
  });
  try {
    tx(refs);
    this.logDebug(LogEvents.REFS_INSERTED, { count: refs.length });
  } catch (err) {
    throw new QueryError('Failed to resolve and insert named refs', { cause: String(err) });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test test/services/DatabaseService.test.ts
```

Expected: all tests PASS (including the 6 new ones).

- [ ] **Step 6: Commit**

```bash
git add src/types/common.ts src/services/DatabaseService.ts test/services/DatabaseService.test.ts
git commit -m "feat(db): add NamedRef type and reference resolution methods"
```

---

### Task 2: Rewrite ParserService.extractReferences

**Files:**
- Modify: `src/services/ParserService.ts`
- Modify: `test/services/ParserService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/services/ParserService.test.ts` after the existing `describe` block:

```typescript
import { join } from 'node:path';

const UTILS_FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/utils.ts');
const ANIMALS_FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/animals.ts');

describe('ParserService — extractReferences', () => {
  const parser = new ParserService();

  beforeAll(() => {
    // Load both files so cross-file references can be extracted
    parser.parseFile(ANIMALS_FIXTURE);
    parser.parseFile(UTILS_FIXTURE);
  });

  it('extracts implements edge from Dog → Animal', () => {
    const allNames = new Set(['Animal', 'Dog', 'Cat', 'greetAnimal', 'makeGreeting', 'PetStatus', 'AnimalKind']);
    const refs = parser.extractReferences(ANIMALS_FIXTURE, allNames);
    const implRefs = refs.filter(r => r.ref_kind === 'implements');
    expect(implRefs.some(r => r.sourceName === 'Dog' && r.targetName === 'Animal')).toBe(true);
    expect(implRefs.some(r => r.sourceName === 'Cat' && r.targetName === 'Animal')).toBe(true);
  });

  it('extracts imports edge from utils.ts → animals.ts', () => {
    const allNames = new Set(['Animal', 'Dog', 'Cat', 'greetAnimal', 'makeGreeting']);
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const importRefs = refs.filter(r => r.ref_kind === 'imports');
    expect(importRefs.length).toBeGreaterThan(0);
    expect(importRefs[0]!.targetFile).toContain('animals.ts');
  });

  it('extracts calls edge from makeGreeting → greetAnimal (cross-file)', () => {
    const allNames = new Set(['Animal', 'Dog', 'Cat', 'greetAnimal', 'makeGreeting']);
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const callRefs = refs.filter(r => r.ref_kind === 'calls');
    expect(callRefs.some(r => r.sourceName === 'makeGreeting' && r.targetName === 'greetAnimal')).toBe(true);
  });

  it('extracts calls edge from makeGreeting → Dog constructor (same-pattern)', () => {
    const allNames = new Set(['Animal', 'Dog', 'Cat', 'greetAnimal', 'makeGreeting']);
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const callRefs = refs.filter(r => r.ref_kind === 'calls');
    expect(callRefs.some(r => r.targetName === 'Dog')).toBe(true);
  });

  it('does not extract calls to symbols not in knownSymbolNames', () => {
    // VERSION is a variable, not a function — no calls to it
    // and console.log etc. are not in the set
    const allNames = new Set(['greetAnimal']); // only greetAnimal
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const callRefs = refs.filter(r => r.ref_kind === 'calls');
    expect(callRefs.every(r => allNames.has(r.targetName))).toBe(true);
  });

  it('returns empty array for file not in project', () => {
    const refs = parser.extractReferences('/nonexistent/file.ts', new Set());
    expect(refs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/services/ParserService.test.ts
```

Expected: FAIL — `extractReferences` signature mismatch, no `calls` edges extracted.

- [ ] **Step 3: Rewrite `extractReferences` and add helpers in `src/services/ParserService.ts`**

Replace the entire import line and add `existsSync` + new ts-morph imports:

```typescript
import { Project, SyntaxKind, type SourceFile, type CallExpression, type MethodDeclaration, type FunctionDeclaration, type Node } from 'ts-morph';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BaseService } from './BaseService';
import { IndexError } from '../errors/IndexError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, NamedRef } from '../types/common';
```

Replace the entire `extractReferences` method and add 4 private helpers at the end of the class (before the closing `}`):

```typescript
/**
 * Extract named references from a file for cross-file resolution.
 * Returns imports, extends, implements, and calls edges.
 * Call extractReferences only after parseFile has been called for this file.
 * @param filePath Absolute path to the file
 * @param knownSymbolNames Set of all project symbol names — calls to names outside this set are ignored
 * @returns NamedRef[] ready for DatabaseService.resolveAndInsertNamedRefs
 */
extractReferences(filePath: string, knownSymbolNames: Set<string>): NamedRef[] {
  try {
    let sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) sourceFile = this.project.addSourceFileAtPath(filePath);
    const refs: NamedRef[] = [];
    const importMap = this.buildImportMap(sourceFile, filePath);

    // imports edges — one per import declaration (file-level relationship anchor)
    for (const imp of sourceFile.getImportDeclarations()) {
      const resolved = this.resolveImportPath(filePath, imp.getModuleSpecifierValue());
      if (!resolved) continue;
      const namedImports = imp.getNamedImports();
      const firstName = namedImports[0]?.getName() ?? imp.getDefaultImport()?.getText();
      if (!firstName) continue;
      refs.push({
        sourceName: '<file>', sourceFile: filePath,
        targetName: firstName, targetFile: resolved,
        ref_kind: 'imports', source_line: imp.getStartLineNumber(), confidence: 'direct'
      });
    }

    // extends / implements edges from class declarations
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? '<anonymous>';
      const baseClass = cls.getBaseClass();
      if (baseClass) {
        const baseName = baseClass.getName() ?? '';
        refs.push({
          sourceName: className, sourceFile: filePath,
          targetName: baseName, targetFile: importMap.get(baseName) ?? null,
          ref_kind: 'extends', source_line: cls.getStartLineNumber(), confidence: 'direct'
        });
      }
      for (const impl of cls.getImplements()) {
        const ifaceName = impl.getExpression().getText();
        refs.push({
          sourceName: className, sourceFile: filePath,
          targetName: ifaceName, targetFile: importMap.get(ifaceName) ?? null,
          ref_kind: 'implements', source_line: cls.getStartLineNumber(), confidence: 'direct'
        });
      }
    }

    // calls edges — traverse all CallExpression nodes
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
      const calleeName = this.getCalleeName(call);
      if (!calleeName || !knownSymbolNames.has(calleeName)) continue;
      const enclosing = this.getEnclosingName(call);
      if (!enclosing) continue;
      refs.push({
        sourceName: enclosing, sourceFile: filePath,
        targetName: calleeName, targetFile: importMap.get(calleeName) ?? null,
        ref_kind: 'calls', source_line: call.getStartLineNumber(), confidence: 'direct'
      });
    }

    this.logDebug(LogEvents.PARSER_REFS_EXTRACTED, { filePath, count: refs.length });
    return refs;
  } catch (err) {
    throw new IndexError(`Failed to extract references from ${filePath}`, { cause: String(err), filePath });
  }
}

/** Build map of importedName → resolved absolute file path from all import declarations. */
private buildImportMap(sourceFile: SourceFile, filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const resolved = this.resolveImportPath(filePath, imp.getModuleSpecifierValue());
    if (!resolved) continue;
    for (const named of imp.getNamedImports()) map.set(named.getName(), resolved);
    const def = imp.getDefaultImport();
    if (def) map.set(def.getText(), resolved);
  }
  return map;
}

/** Resolve a relative import specifier to an absolute .ts file path. Returns null for node_modules. */
private resolveImportPath(sourceFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(sourceFile), specifier);
  for (const suffix of ['.ts', '/index.ts', '.tsx', '/index.tsx']) {
    const full = base + suffix;
    if (existsSync(full)) return full;
  }
  return null;
}

/** Extract the callee name from a CallExpression. Returns the method name for obj.method() calls. */
private getCalleeName(call: CallExpression): string | null {
  const expr = call.getExpression();
  const kind = expr.getKindName();
  if (kind === 'Identifier') return expr.getText();
  if (kind === 'PropertyAccessExpression') {
    const text = expr.getText();
    return text.split('.').pop() ?? null;
  }
  return null;
}

/** Walk ancestors to find the enclosing named function or method. Returns null for module-level code. */
private getEnclosingName(node: Node): string | null {
  for (const ancestor of node.getAncestors()) {
    const kind = ancestor.getKindName();
    if (kind === 'MethodDeclaration') return (ancestor as MethodDeclaration).getName();
    if (kind === 'FunctionDeclaration') return (ancestor as FunctionDeclaration).getName() ?? null;
    if (kind === 'Constructor') return 'constructor';
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/services/ParserService.test.ts
```

Expected: all tests PASS (including the 6 new ones).

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
bun test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ParserService.ts src/types/common.ts test/services/ParserService.test.ts
git commit -m "feat(parser): rewrite extractReferences with call graph and import map resolution"
```

---

### Task 3: Wire IndexerService — two-pass scanProject + refs in reindexFile

**Files:**
- Modify: `src/services/IndexerService.ts`

- [ ] **Step 1: Replace `reindexFile` and `scanProject` in `src/services/IndexerService.ts`**

The full new `IndexerService.ts`:

```typescript
import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ParserService } from './ParserService';

/** @interface FlushResult — returned by flush_file tool */
export interface FlushResult {
  success: boolean;
  symbols_indexed: number;
  time_ms: number;
}

/**
 * @class IndexerService
 * @description Orchestrates file watching, debounced re-indexing, and full project scans.
 * scanProject uses a two-pass strategy: index all symbols first, then resolve all references.
 * This ensures cross-file call graph edges resolve correctly regardless of file order.
 * Known limitation: incremental re-index (single file) only rebuilds that file's outgoing refs.
 * Refs FROM other files pointing TO the re-indexed file's symbols are rebuilt on next full scan.
 */
export class IndexerService extends BaseService {
  private readonly db: DatabaseService;
  private readonly parser: ParserService;
  private readonly pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;

  constructor(db: DatabaseService, parser: ParserService) {
    super('IndexerService');
    this.db = db;
    this.parser = parser;
  }

  /**
   * Schedule a debounced re-index for a file (used by chokidar watcher).
   * @param filePath File that changed
   */
  scheduleReindex(filePath: string): void {
    const existing = this.pendingDebounce.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingDebounce.delete(filePath);
      this.reindexFile(filePath).catch(err =>
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath })
      );
    }, this.DEBOUNCE_MS);
    this.pendingDebounce.set(filePath, timer);
  }

  /**
   * Re-index a single file: symbols + references. Used by incremental watcher and flush_file.
   * Outgoing references from this file are rebuilt. Refs from other files pointing here
   * are NOT rebuilt — they remain valid until next scanProject (IDs are stable).
   * @param filePath Absolute path to the file
   */
  async reindexFile(filePath: string): Promise<void> {
    const start = Date.now();
    await this.indexSymbols(filePath);
    const knownNames = this.db.getAllSymbolNames();
    this.indexRefs(filePath, knownNames);
    this.logInfo(LogEvents.INDEXER_FILE_CHANGED, {
      filePath, ms: Date.now() - start
    });
  }

  /**
   * Force synchronous re-index, bypassing debounce. Used by flush_file MCP tool.
   * @param filePath File to re-index
   * @returns FlushResult with symbol count and timing
   */
  async flushFile(filePath: string): Promise<FlushResult> {
    const pending = this.pendingDebounce.get(filePath);
    if (pending) {
      clearTimeout(pending);
      this.pendingDebounce.delete(filePath);
    }
    const start = Date.now();
    try {
      await this.reindexFile(filePath);
      const symbols = this.db.getSymbolsByFile(filePath);
      this.logInfo(LogEvents.INDEXER_FLUSH, { filePath, symbols: symbols.length });
      return { success: true, symbols_indexed: symbols.length, time_ms: Date.now() - start };
    } catch (err) {
      this.logError(LogEvents.INDEXER_FLUSH, err, { filePath });
      return { success: false, symbols_indexed: 0, time_ms: Date.now() - start };
    }
  }

  /**
   * Two-pass full project scan.
   * Pass 1: index all symbols (skip unchanged files by hash).
   * Pass 2: extract and resolve references for ALL files (ensures cross-file edges resolve).
   * @param projectRoot Absolute project root path
   */
  async scanProject(projectRoot: string): Promise<void> {
    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot });
    const files = this.collectTypeScriptFiles(projectRoot);

    // Pass 1: symbols
    let indexed = 0;
    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        const existing = this.db.getFileRecord(filePath);
        if (existing?.content_hash === hash) {
          this.logDebug(LogEvents.INDEXER_FILE_SKIPPED, { filePath });
          // Still need the file in the ts-morph project for ref extraction pass
          this.parser.parseFile(filePath);
          continue;
        }
        await this.indexSymbols(filePath);
        indexed++;
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }

    // Pass 2: references (all files — cross-file resolution requires all symbols to be present)
    const knownNames = this.db.getAllSymbolNames();
    for (const filePath of files) {
      try {
        this.indexRefs(filePath, knownNames);
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }

    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot, indexed, total: files.length });
  }

  /**
   * Start chokidar file watcher. Returns watcher for cleanup on shutdown.
   * @param projectRoot Absolute project root path
   */
  startWatcher(projectRoot: string): ReturnType<typeof watch> {
    const watcher = watch('**/*.{ts,tsx}', {
      cwd: projectRoot,
      ignored: /(node_modules|dist|\.tsa|\.git)/,
      persistent: true,
      ignoreInitial: true
    });
    watcher.on('add', (rel) => this.scheduleReindex(join(projectRoot, rel)));
    watcher.on('change', (rel) => this.scheduleReindex(join(projectRoot, rel)));
    watcher.on('unlink', (rel) => {
      const abs = join(projectRoot, rel);
      this.db.deleteFileSymbols(abs);
      this.logInfo(LogEvents.INDEXER_FILE_DELETED, { filePath: abs });
    });
    return watcher;
  }

  /** Index symbols only (no refs). Used in scanProject pass 1. */
  private async indexSymbols(filePath: string): Promise<void> {
    const start = Date.now();
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const stat = statSync(filePath);
    this.db.deleteFileSymbols(filePath);
    const symbols = this.parser.parseFile(filePath);
    this.db.insertSymbols(symbols);
    this.db.upsertFile({
      path: filePath, last_modified: stat.mtimeMs,
      content_hash: hash, symbol_count: symbols.length,
      index_time_ms: Date.now() - start
    });
  }

  /** Extract and insert refs for a file. Used in reindexFile and scanProject pass 2. */
  private indexRefs(filePath: string, knownNames: Set<string>): void {
    this.db.deleteFileReferences(filePath);
    const namedRefs = this.parser.extractReferences(filePath, knownNames);
    this.db.resolveAndInsertNamedRefs(namedRefs);
  }

  private collectTypeScriptFiles(projectRoot: string): string[] {
    const files: string[] = [];
    const SKIP = new Set(['node_modules', 'dist', '.tsa', '.git']);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (SKIP.has(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(join(dir, entry.name));
        }
      }
    };
    walk(projectRoot);
    return files;
  }
}
```

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/IndexerService.ts
git commit -m "feat(indexer): two-pass scanProject and wire reference extraction into reindexFile"
```

---

### Task 4: Update integration test + verify cross-file get_callers

**Files:**
- Modify: `test/integration.test.ts`

- [ ] **Step 1: Update `test/integration.test.ts`**

Replace the full file with:

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
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
    const utilsPath = join(FIXTURE, 'src/utils.ts');
    const result = referenceService.getRelatedFiles({ file_path: utilsPath });
    expect(result.imports_from.some(f => f.includes('animals.ts'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
bun test test/integration.test.ts
```

Expected: all 8 tests PASS (including 3 new reference tests).

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: all tests PASS. No regressions.

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.ts
git commit -m "test(integration): verify cross-file get_callers, get_implementations, get_related_files"
```

---

## Self-Review Against Spec

| Spec Requirement | Covered by Task |
|---|---|
| NamedRef type with sourceName/targetName/targetFile | Task 1 |
| getAllSymbolNames for project-only filtering | Task 1 |
| deleteFileReferences | Task 1 |
| resolveAndInsertNamedRefs — (name+file) when targetFile present | Task 1 |
| resolveAndInsertNamedRefs — name-only fallback when targetFile null | Task 1 |
| `<file>` sentinel for import edge source | Task 1 |
| extractReferences returns NamedRef[] | Task 2 |
| buildImportMap from ImportDeclarations | Task 2 |
| resolveImportPath — .ts / /index.ts / .tsx | Task 2 |
| imports edges via import declarations | Task 2 |
| extends / implements edges from class declarations | Task 2 |
| calls edges via CallExpression traversal | Task 2 |
| getCalleeName — Identifier + PropertyAccessExpression | Task 2 |
| getEnclosingName — MethodDeclaration / FunctionDeclaration / Constructor | Task 2 |
| project-only filter via knownSymbolNames | Task 2 |
| lazy sourceFile load in extractReferences | Task 2 |
| reindexFile wires symbols + refs | Task 3 |
| scanProject two-pass (symbols then refs) | Task 3 |
| unchanged files re-added to ts-morph project for pass 2 | Task 3 |
| indexRefs private method | Task 3 |
| cross-file get_callers integration test | Task 4 |
| get_implementations integration test | Task 4 |
| get_related_files integration test | Task 4 |
