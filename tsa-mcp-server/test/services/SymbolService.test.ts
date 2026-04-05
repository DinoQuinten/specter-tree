import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import { SymbolService } from '../../src/services/SymbolService';
import type { TsaSymbol } from '../../src/types/common';

function setup(): { db: DatabaseService; svc: SymbolService } {
  const raw = new Database(':memory:');
  const db = new DatabaseService(raw);
  db.initialize();
  const svc = new SymbolService(db);
  return { db, svc };
}

const CLASS_SYM: TsaSymbol = {
  name: 'UserService', kind: 'class', file_path: '/proj/src/user.ts',
  line: 5, column: 0, end_line: 50, parent_id: null,
  signature: null, modifiers: 'export', return_type: null, params: null, doc_comment: null
};

const METHOD_SYM: TsaSymbol = {
  name: 'findUser', kind: 'method', file_path: '/proj/src/user.ts',
  line: 10, column: 2, end_line: 15, parent_id: null, _parentName: 'UserService',
  signature: 'findUser(id: string): User', modifiers: 'public', return_type: 'User', params: 'id: string', doc_comment: null
};

describe('SymbolService', () => {
  let db: DatabaseService;
  let svc: SymbolService;

  beforeEach(() => {
    ({ db, svc } = setup());
    db.insertSymbols([CLASS_SYM, METHOD_SYM]);
  });

  it('findSymbol returns exact name match', () => {
    const result = svc.findSymbol({ name: 'UserService' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.kind).toBe('class');
    expect(result._meta.correlationId).toBeTruthy();
  });

  it('findSymbol with kind filter', () => {
    const result = svc.findSymbol({ name: 'UserService', kind: 'interface' });
    expect(result.results).toHaveLength(0);
  });

  it('searchSymbols finds partial matches', () => {
    const result = svc.searchSymbols({ query: 'User' });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it('getMethods returns class methods', () => {
    const result = svc.getMethods({ class_name: 'UserService' });
    expect(result.results.some(r => r.name === 'findUser')).toBe(true);
  });

  it('getMethods aggregates duplicate class names across files', () => {
    db.insertSymbols([
      {
        ...CLASS_SYM,
        file_path: '/proj/src/admin-user.ts'
      },
      {
        ...METHOD_SYM,
        name: 'findAdminUser',
        file_path: '/proj/src/admin-user.ts'
      }
    ]);

    const result = svc.getMethods({ class_name: 'UserService' });
    expect(result.results.some(r => r.name === 'findUser')).toBe(true);
    expect(result.results.some(r => r.name === 'findAdminUser')).toBe(true);
  });

  it('getFileSymbols returns all symbols in file', () => {
    const result = svc.getFileSymbols({ file_path: '/proj/src/user.ts' });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it('response always includes _meta with correlationId', () => {
    const r = svc.findSymbol({ name: 'NotFound' });
    expect(r._meta.correlationId).toMatch(/[0-9a-f-]{36}/);
    expect(typeof r._meta.query_ms).toBe('number');
  });
});
