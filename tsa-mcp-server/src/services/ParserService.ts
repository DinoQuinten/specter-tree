import { Project, type SourceFile } from 'ts-morph';
import { BaseService } from './BaseService';
import { IndexError } from '../errors/IndexError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol } from '../types/common';

/**
 * @class ParserService
 * @description Extracts symbols from TypeScript files using ts-morph AST parsing.
 * Returns flat symbol list with _parentName for two-pass DB insert.
 * Known limitations: cannot resolve DI-injected refs, dynamic dispatch, or string events.
 */
export class ParserService extends BaseService {
  private readonly project: Project;

  /**
   * @param tsConfigPath Optional path to tsconfig.json for the project being indexed
   */
  constructor(tsConfigPath?: string) {
    super('ParserService');
    this.project = new Project({
      ...(tsConfigPath ? { tsConfigFilePath: tsConfigPath } : {
        compilerOptions: { target: 99, strict: true, allowJs: false }
      }),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true
    });
  }

  /**
   * Parse a TypeScript file and extract all symbols.
   * @param filePath Absolute path to .ts or .tsx file
   * @returns Flat array of TsaSymbol with _parentName for children
   * @throws IndexError if ts-morph fails to parse
   */
  parseFile(filePath: string): TsaSymbol[] {
    try {
      const existing = this.project.getSourceFile(filePath);
      if (existing) this.project.removeSourceFile(existing);
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const symbols: TsaSymbol[] = [];

      this.extractClasses(sourceFile, filePath, symbols);
      this.extractInterfaces(sourceFile, filePath, symbols);
      this.extractFunctions(sourceFile, filePath, symbols);
      this.extractEnums(sourceFile, filePath, symbols);
      this.extractTypeAliases(sourceFile, filePath, symbols);
      this.extractVariables(sourceFile, filePath, symbols);

      this.logDebug(LogEvents.PARSER_FILE_PARSED, { filePath, count: symbols.length });
      return symbols;
    } catch (err) {
      if (err instanceof IndexError) throw err;
      throw new IndexError(`Failed to parse ${filePath}`, { cause: String(err), filePath });
    }
  }

  /**
   * Extract import/extends/implements references from a file.
   * Returns partial references — DatabaseService resolves symbol IDs on insert.
   * @param filePath Absolute file path
   * @param _symbols Symbols already extracted (reserved for future call graph expansion)
   * @returns Partial reference data (without source/target IDs)
   */
  extractReferences(filePath: string, _symbols: TsaSymbol[]): Array<{ ref_kind: string; source_line: number | null; confidence: string }> {
    try {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) return [];
      const refs: Array<{ ref_kind: string; source_line: number | null; confidence: string }> = [];

      for (const imp of sourceFile.getImportDeclarations()) {
        refs.push({ ref_kind: 'imports', source_line: imp.getStartLineNumber(), confidence: 'direct' });
      }
      for (const cls of sourceFile.getClasses()) {
        if (cls.getBaseClass()) {
          refs.push({ ref_kind: 'extends', source_line: cls.getStartLineNumber(), confidence: 'direct' });
        }
        for (const _impl of cls.getImplements()) {
          refs.push({ ref_kind: 'implements', source_line: cls.getStartLineNumber(), confidence: 'direct' });
        }
      }

      this.logDebug(LogEvents.PARSER_REFS_EXTRACTED, { filePath, count: refs.length });
      return refs;
    } catch (err) {
      throw new IndexError(`Failed to extract references from ${filePath}`, { cause: String(err), filePath });
    }
  }

  private extractClasses(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() ?? '<anonymous>';
      symbols.push({
        name, kind: 'class', file_path: filePath,
        line: cls.getStartLineNumber(), column: 0, end_line: cls.getEndLineNumber(),
        parent_id: null, signature: `class ${name}`, modifiers: this.getMods(cls),
        return_type: null, params: null, doc_comment: this.getDoc(cls)
      });
      for (const method of cls.getMethods()) {
        symbols.push({
          name: method.getName(), kind: 'method', file_path: filePath,
          line: method.getStartLineNumber(), column: 0, end_line: method.getEndLineNumber(),
          parent_id: null,
          signature: method.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
          modifiers: this.getMods(method),
          return_type: method.getReturnType().getText(),
          params: method.getParameters().map(p => p.getText()).join(', '),
          doc_comment: this.getDoc(method), _parentName: name
        });
      }
      for (const ctor of cls.getConstructors()) {
        symbols.push({
          name: 'constructor', kind: 'constructor', file_path: filePath,
          line: ctor.getStartLineNumber(), column: 0, end_line: ctor.getEndLineNumber(),
          parent_id: null,
          signature: `constructor(${ctor.getParameters().map(p => p.getText()).join(', ')})`,
          modifiers: '', return_type: null,
          params: ctor.getParameters().map(p => p.getText()).join(', '),
          doc_comment: this.getDoc(ctor), _parentName: name
        });
      }
      for (const prop of cls.getProperties()) {
        symbols.push({
          name: prop.getName(), kind: 'property', file_path: filePath,
          line: prop.getStartLineNumber(), column: 0, end_line: prop.getEndLineNumber(),
          parent_id: null, signature: prop.getText().trim(), modifiers: this.getMods(prop),
          return_type: prop.getType().getText(), params: null,
          doc_comment: this.getDoc(prop), _parentName: name
        });
      }
    }
  }

  private extractInterfaces(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const iface of sourceFile.getInterfaces()) {
      symbols.push({
        name: iface.getName(), kind: 'interface', file_path: filePath,
        line: iface.getStartLineNumber(), column: 0, end_line: iface.getEndLineNumber(),
        parent_id: null, signature: `interface ${iface.getName()}`, modifiers: this.getMods(iface),
        return_type: null, params: null, doc_comment: this.getDoc(iface)
      });
    }
  }

  private extractFunctions(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const fn of sourceFile.getFunctions()) {
      symbols.push({
        name: fn.getName() ?? '<anonymous>', kind: 'function', file_path: filePath,
        line: fn.getStartLineNumber(), column: 0, end_line: fn.getEndLineNumber(),
        parent_id: null,
        signature: fn.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
        modifiers: this.getMods(fn),
        return_type: fn.getReturnType().getText(),
        params: fn.getParameters().map(p => p.getText()).join(', '),
        doc_comment: this.getDoc(fn)
      });
    }
  }

  private extractEnums(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const en of sourceFile.getEnums()) {
      symbols.push({
        name: en.getName(), kind: 'enum', file_path: filePath,
        line: en.getStartLineNumber(), column: 0, end_line: en.getEndLineNumber(),
        parent_id: null, signature: `enum ${en.getName()}`, modifiers: this.getMods(en),
        return_type: null, params: null, doc_comment: this.getDoc(en)
      });
      for (const member of en.getMembers()) {
        symbols.push({
          name: member.getName(), kind: 'enum_member', file_path: filePath,
          line: member.getStartLineNumber(), column: 0, end_line: null,
          parent_id: null, signature: member.getText(), modifiers: '',
          return_type: null, params: null, doc_comment: null, _parentName: en.getName()
        });
      }
    }
  }

  private extractTypeAliases(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const ta of sourceFile.getTypeAliases()) {
      symbols.push({
        name: ta.getName(), kind: 'type_alias', file_path: filePath,
        line: ta.getStartLineNumber(), column: 0, end_line: ta.getEndLineNumber(),
        parent_id: null, signature: `type ${ta.getName()}`, modifiers: this.getMods(ta),
        return_type: ta.getType().getText(), params: null, doc_comment: this.getDoc(ta)
      });
    }
  }

  private extractVariables(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        symbols.push({
          name: decl.getName(), kind: 'variable', file_path: filePath,
          line: decl.getStartLineNumber(), column: 0, end_line: decl.getEndLineNumber(),
          parent_id: null, signature: decl.getText().split('\n')[0]!.trim(),
          modifiers: 'export', return_type: decl.getType().getText(),
          params: null, doc_comment: null
        });
      }
    }
  }

  private getMods(node: unknown): string {
    const n = node as Record<string, unknown>;
    const mods: string[] = [];
    if (typeof n['isExported'] === 'function' && (n['isExported'] as () => boolean)()) mods.push('export');
    if (typeof n['isAbstract'] === 'function' && (n['isAbstract'] as () => boolean)()) mods.push('abstract');
    if (typeof n['isAsync'] === 'function' && (n['isAsync'] as () => boolean)()) mods.push('async');
    if (typeof n['isStatic'] === 'function' && (n['isStatic'] as () => boolean)()) mods.push('static');
    return mods.join(' ');
  }

  private getDoc(node: unknown): string | null {
    const n = node as Record<string, unknown>;
    if (typeof n['getJsDocs'] !== 'function') return null;
    const docs = (n['getJsDocs'] as () => Array<{ getComment: () => string | undefined }>)();
    if (!docs.length) return null;
    return docs.map(d => d.getComment()).filter(Boolean).join('\n') || null;
  }
}
