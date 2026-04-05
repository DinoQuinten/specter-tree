import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import { ReferenceService } from '../../src/services/ReferenceService';
import type { TsaSymbol, NamedRef } from '../../src/types/common';

function setup(): { db: DatabaseService; svc: ReferenceService } {
  const raw = new Database(':memory:');
  const db = new DatabaseService(raw);
  db.initialize();
  const svc = new ReferenceService(db);
  return { db, svc };
}

const makeClass = (name: string, filePath: string, line: number): TsaSymbol => ({
  name,
  kind: 'class',
  file_path: filePath,
  line,
  column: 0,
  end_line: line + 10,
  parent_id: null,
  signature: `class ${name}`,
  modifiers: 'export',
  return_type: null,
  params: null,
  doc_comment: null
});

const makeMethod = (className: string, name: string, filePath: string, line: number): TsaSymbol => ({
  name,
  kind: 'method',
  file_path: filePath,
  line,
  column: 0,
  end_line: line + 1,
  parent_id: null,
  _parentName: className,
  signature: `${name}(): void`,
  modifiers: 'public',
  return_type: 'void',
  params: null,
  doc_comment: null
});

const makeFunction = (name: string, filePath: string, line: number): TsaSymbol => ({
  name,
  kind: 'function',
  file_path: filePath,
  line,
  column: 0,
  end_line: line + 1,
  parent_id: null,
  signature: `function ${name}(): void`,
  modifiers: 'export',
  return_type: 'void',
  params: null,
  doc_comment: null
});

describe('ReferenceService', () => {
  let db: DatabaseService;
  let svc: ReferenceService;

  beforeEach(() => {
    ({ db, svc } = setup());
  });

  it('getCallers honors class_name for duplicate method names', () => {
    db.insertSymbols([
      makeClass('AlphaController', '/proj/src/alpha.ts', 1),
      makeMethod('AlphaController', 'handle', '/proj/src/alpha.ts', 2),
      makeClass('BetaController', '/proj/src/beta.ts', 1),
      makeMethod('BetaController', 'handle', '/proj/src/beta.ts', 2),
      makeFunction('callAlpha', '/proj/src/call-alpha.ts', 1),
      makeFunction('callBeta', '/proj/src/call-beta.ts', 1)
    ]);

    const refs: NamedRef[] = [
      {
        sourceName: 'callAlpha',
        sourceFile: '/proj/src/call-alpha.ts',
        targetName: 'handle',
        targetFile: '/proj/src/alpha.ts',
        ref_kind: 'calls',
        source_line: 4,
        confidence: 'direct'
      },
      {
        sourceName: 'callBeta',
        sourceFile: '/proj/src/call-beta.ts',
        targetName: 'handle',
        targetFile: '/proj/src/beta.ts',
        ref_kind: 'calls',
        source_line: 5,
        confidence: 'direct'
      }
    ];

    db.resolveAndInsertNamedRefs(refs);

    const result = svc.getCallers({ symbol_name: 'handle', class_name: 'BetaController' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.caller_name).toBe('callBeta');
  });

  it('getHierarchy merges duplicate class names across files instead of taking the first match only', () => {
    db.insertSymbols([
      makeClass('SharedController', '/proj/src/one.ts', 1),
      makeClass('BaseOne', '/proj/src/base-one.ts', 1),
      makeClass('SharedController', '/proj/src/two.ts', 1),
      makeClass('BaseTwo', '/proj/src/base-two.ts', 1)
    ]);

    db.resolveAndInsertNamedRefs([
      {
        sourceName: 'SharedController',
        sourceFile: '/proj/src/one.ts',
        targetName: 'BaseOne',
        targetFile: '/proj/src/base-one.ts',
        ref_kind: 'extends',
        source_line: 1,
        confidence: 'direct'
      },
      {
        sourceName: 'SharedController',
        sourceFile: '/proj/src/two.ts',
        targetName: 'BaseTwo',
        targetFile: '/proj/src/base-two.ts',
        ref_kind: 'extends',
        source_line: 1,
        confidence: 'direct'
      }
    ]);

    const result = svc.getHierarchy({ class_name: 'SharedController' });
    const names = result.extends.map(entry => entry.name).sort();

    expect(names).toEqual(['BaseOne', 'BaseTwo']);
  });
});
