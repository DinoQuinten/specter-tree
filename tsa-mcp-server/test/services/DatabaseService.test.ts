import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import type { TsaSymbol, NamedRef } from '../../src/types/common';

function makeDb(): DatabaseService {
  const db = new Database(':memory:');
  const svc = new DatabaseService(db);
  svc.initialize();
  return svc;
}

const BASE_SYMBOL: TsaSymbol = {
  name: 'TestClass',
  kind: 'class',
  file_path: '/proj/src/test.ts',
  line: 1,
  column: 0,
  end_line: 20,
  parent_id: null,
  signature: null,
  modifiers: 'export',
  return_type: null,
  params: null,
  doc_comment: null
};

describe('DatabaseService', () => {
  let svc: DatabaseService;

  beforeAll(() => {
    svc = makeDb();
  });

  beforeEach(() => {
    svc.deleteFileSymbols('/proj/src/test.ts');
    svc.deleteFileSymbols('/proj/src/caller.ts');
    svc.deleteFileSymbols('/proj/src/a.ts');
  });

  it('initializes schema and returns version 1', () => {
    expect(svc.getSchemaVersion()).toBe(1);
  });

  it('inserts and retrieves top-level symbol', () => {
    svc.insertSymbols([BASE_SYMBOL]);
    const results = svc.querySymbolsByName('TestClass');
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe('class');
    expect(results[0]!.file_path).toBe('/proj/src/test.ts');
  });

  it('resolves _parentName to parent_id in two-pass insert', () => {
    const method: TsaSymbol = {
      ...BASE_SYMBOL,
      name: 'doWork',
      kind: 'method',
      parent_id: null,
      _parentName: 'TestClass'
    };
    svc.insertSymbols([BASE_SYMBOL, method]);
    const methods = svc.getMethodsByClassName('TestClass');
    expect(methods.some(m => m.name === 'doWork')).toBe(true);
    const parentRow = svc.querySymbolsByName('TestClass')[0]!;
    const methodRow = svc.querySymbolsByName('doWork')[0]!;
    expect(methodRow.parent_id).toBe(parentRow.id);
  });

  it('searchSymbols returns partial matches', () => {
    svc.insertSymbols([BASE_SYMBOL, { ...BASE_SYMBOL, name: 'TestInterface', kind: 'interface', file_path: '/proj/src/a.ts' }]);
    const results = svc.searchSymbols('Test');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('deleteFileSymbols removes all symbols for a file', () => {
    svc.insertSymbols([BASE_SYMBOL]);
    svc.deleteFileSymbols('/proj/src/test.ts');
    const results = svc.querySymbolsByName('TestClass');
    expect(results).toHaveLength(0);
  });

  it('upsertFile and getFileRecord round-trip', () => {
    svc.upsertFile({ path: '/proj/src/test.ts', last_modified: 1000, content_hash: 'abc', symbol_count: 1, index_time_ms: 5 });
    const rec = svc.getFileRecord('/proj/src/test.ts');
    expect(rec).not.toBeNull();
    expect(rec!.content_hash).toBe('abc');
  });

  it('inserts references and retrieves callers', () => {
    svc.insertSymbols([BASE_SYMBOL, { ...BASE_SYMBOL, name: 'callerFn', kind: 'function', file_path: '/proj/src/caller.ts' }]);
    const target = svc.querySymbolsByName('TestClass')[0]!;
    const caller = svc.querySymbolsByName('callerFn')[0]!;
    svc.insertReferences([{ source_symbol_id: caller.id, target_symbol_id: target.id, ref_kind: 'calls', source_line: 5, confidence: 'direct' }]);
    const callers = svc.getCallers(target.id);
    expect(callers).toHaveLength(1);
    expect(callers[0]!.caller_name).toBe('callerFn');
  });
});

describe('DatabaseService — reference methods', () => {
  let svc: DatabaseService;

  beforeAll(() => {
    svc = makeDb();
    svc.insertSymbols([
      BASE_SYMBOL,
      { ...BASE_SYMBOL, name: 'callerFn', kind: 'function' as const, file_path: '/proj/src/caller.ts' },
      { ...BASE_SYMBOL, name: 'Animal', kind: 'interface' as const, file_path: '/proj/src/animal.ts' }
    ]);
  });

  beforeEach(() => {
    svc.deleteFileReferences('/proj/src/caller.ts');
    svc.deleteFileReferences('/proj/src/test.ts');
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
