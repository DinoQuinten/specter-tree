import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import type { TsaSymbol } from '../../src/types/common';

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

  beforeEach(() => {
    svc = makeDb();
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
