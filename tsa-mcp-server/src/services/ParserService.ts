import { Project, SyntaxKind, type SourceFile, type CallExpression, type MethodDeclaration, type FunctionDeclaration, type Node, type NewExpression } from 'ts-morph';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BaseService } from './BaseService';
import { IndexError } from '../errors/IndexError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, NamedRef } from '../types/common';

/**
 * @class ParserService
 * @description Extracts symbols and references from TypeScript files using ts-morph AST parsing.
 * Returns flat symbol list with _parentName for two-pass DB insert.
 * Known limitations: cannot resolve DI-injected refs, dynamic dispatch, or string events.
 */
export class ParserService extends BaseService {
  private readonly project: Project;

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
   * Extract named references from a file for cross-file resolution.
   * Returns imports, extends, implements, and calls edges.
   * The file must have been added to the ts-morph project first (via parseFile or lazy load).
   * @param filePath Absolute path to the file
   * @param knownSymbolNames Set of all project symbol names — calls to names outside this set are ignored
   */
  extractReferences(filePath: string, knownSymbolNames: Set<string>): NamedRef[] {
    try {
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        if (!existsSync(filePath)) return [];
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
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

      // new expressions — capture constructor calls (NewExpression is distinct from CallExpression)
      for (const newExpr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as NewExpression[]) {
        const calleeName = newExpr.getExpression().getText();
        if (!knownSymbolNames.has(calleeName)) continue;
        const enclosing = this.getEnclosingName(newExpr);
        if (!enclosing) continue;
        refs.push({
          sourceName: enclosing, sourceFile: filePath,
          targetName: calleeName, targetFile: importMap.get(calleeName) ?? null,
          ref_kind: 'calls', source_line: newExpr.getStartLineNumber(), confidence: 'direct'
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

  /** Resolve a relative import specifier to an absolute .ts file path. Returns null for node_modules or unresolvable. */
  private resolveImportPath(sourceFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = join(dirname(sourceFile), specifier);
    for (const suffix of ['.ts', '/index.ts', '.tsx', '/index.tsx']) {
      const full = base + suffix;
      if (existsSync(full)) return full;
    }
    return null;
  }

  /** Extract callee name from a CallExpression. Returns last segment for obj.method() calls. */
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
