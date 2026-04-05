import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParserService } from '../../src/services/ParserService';

const FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/animals.ts');
const UTILS_FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/utils.ts');
const ANIMALS_FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/animals.ts');

describe('ParserService', () => {
  const parser = new ParserService();

  it('extracts class symbols', () => {
    const symbols = parser.parseFile(FIXTURE);
    const classes = symbols.filter(s => s.kind === 'class');
    expect(classes.map(c => c.name)).toContain('Dog');
    expect(classes.map(c => c.name)).toContain('Cat');
  });

  it('extracts interface symbols', () => {
    const symbols = parser.parseFile(FIXTURE);
    const ifaces = symbols.filter(s => s.kind === 'interface');
    expect(ifaces.map(i => i.name)).toContain('Animal');
  });

  it('extracts function symbols', () => {
    const symbols = parser.parseFile(FIXTURE);
    const fns = symbols.filter(s => s.kind === 'function');
    expect(fns.map(f => f.name)).toContain('greetAnimal');
  });

  it('extracts enum and type_alias', () => {
    const symbols = parser.parseFile(FIXTURE);
    expect(symbols.some(s => s.kind === 'enum' && s.name === 'PetStatus')).toBe(true);
    expect(symbols.some(s => s.kind === 'type_alias' && s.name === 'AnimalKind')).toBe(true);
  });

  it('sets _parentName on methods', () => {
    const symbols = parser.parseFile(FIXTURE);
    const methods = symbols.filter(s => s.kind === 'method');
    expect(methods.every(m => m._parentName !== undefined)).toBe(true);
    const dogMethods = methods.filter(m => m._parentName === 'Dog');
    expect(dogMethods.map(m => m.name)).toContain('speak');
    expect(dogMethods.map(m => m.name)).toContain('fetch');
  });

  it('sets file_path and line number', () => {
    const symbols = parser.parseFile(FIXTURE);
    expect(symbols.every(s => s.file_path === FIXTURE)).toBe(true);
    expect(symbols.every(s => s.line > 0)).toBe(true);
  });
});

describe('ParserService — extractReferences', () => {
  const parser = new ParserService();

  beforeAll(() => {
    parser.parseFile(ANIMALS_FIXTURE);
    parser.parseFile(UTILS_FIXTURE);
  });

  it('extracts implements edges from Dog → Animal and Cat → Animal', () => {
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

  it('extracts calls edge for Dog constructor call', () => {
    const allNames = new Set(['Animal', 'Dog', 'Cat', 'greetAnimal', 'makeGreeting']);
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const callRefs = refs.filter(r => r.ref_kind === 'calls');
    expect(callRefs.some(r => r.targetName === 'Dog')).toBe(true);
  });

  it('does not extract calls to symbols not in knownSymbolNames', () => {
    const allNames = new Set(['greetAnimal']);
    const refs = parser.extractReferences(UTILS_FIXTURE, allNames);
    const callRefs = refs.filter(r => r.ref_kind === 'calls');
    expect(callRefs.every(r => allNames.has(r.targetName))).toBe(true);
  });

  it('returns empty array for file not in project', () => {
    const refs = parser.extractReferences('/nonexistent/file.ts', new Set());
    expect(refs).toHaveLength(0);
  });
});

describe('ParserService — modern symbol/reference extraction', () => {
  it('extracts getter and setter symbols plus decorator and type references', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'tsa-parser-'));
    const filePath = join(tempRoot, 'sample.ts');
    writeFileSync(filePath, `function sealed() { return () => {}; }

interface Person {
  name: string;
}

@sealed()
export class UserStore {
  private _person: Person;

  constructor(person: Person) {
    this._person = person;
  }

  get person(): Person {
    return this._person;
  }

  set person(value: Person) {
    this._person = value;
  }
}
`);

    try {
      const parser = new ParserService();
      const symbols = parser.parseFile(filePath);
      expect(symbols.some(s => s.kind === 'getter' && s.name === 'person')).toBe(true);
      expect(symbols.some(s => s.kind === 'setter' && s.name === 'person')).toBe(true);

      const refs = parser.extractReferences(filePath, new Set(['sealed', 'Person', 'UserStore']));
      expect(refs.some(r => r.ref_kind === 'decorator' && r.targetName === 'sealed')).toBe(true);
      expect(refs.some(r => r.ref_kind === 'type_ref' && r.targetName === 'Person')).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
