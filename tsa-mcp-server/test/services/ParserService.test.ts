import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { ParserService } from '../../src/services/ParserService';

const FIXTURE = join(import.meta.dir, '../fixtures/simple-ts-project/src/animals.ts');

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
