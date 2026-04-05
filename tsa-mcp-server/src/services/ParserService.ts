/**
 * @file ParserService.ts
 * @description Extracts symbols and named cross-file references from TypeScript source files
 * using ts-morph AST parsing. Returns flat symbol lists and NamedRef edges suitable for
 * two-pass database insertion and call-graph construction.
 * @module services
 */
import { Project, SyntaxKind, type SourceFile, type CallExpression, type MethodDeclaration, type FunctionDeclaration, type Node, type NewExpression, type ClassDeclaration, type GetAccessorDeclaration, type SetAccessorDeclaration, type TypeReferenceNode, type Decorator } from 'ts-morph';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BaseService } from './BaseService';
import { IndexError } from '../errors/IndexError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, NamedRef } from '../types/common';

/**
 * @class ParserService
 * @description Extracts symbols and references from TypeScript files using ts-morph AST parsing.
 * Returns flat symbol lists with _parentName for two-pass DB insertion.
 * Known limitations: cannot resolve DI-injected refs, dynamic dispatch, or string events.
 * @example
 * const parser = new ParserService('/repo/tsconfig.json');
 * const symbols = parser.parseFile('/repo/src/index.ts');
 */
export class ParserService extends BaseService {
  private readonly project: Project;

  /**
   * @description Creates a ParserService backed by a ts-morph Project.
   * When tsConfigPath is provided the project inherits compiler options from that file;
   * otherwise strict defaults are applied.
   * @param tsConfigPath - Optional absolute path to a tsconfig.json.
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
   * @description Parses a TypeScript file and extracts all symbols.
   * @param filePath - Absolute path to the .ts or .tsx file to parse.
   * @returns Flat array of TsaSymbol; child symbols carry a _parentName for two-pass DB insert.
   * @throws {IndexError} - When ts-morph fails to parse the file.
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
   * @description Extracts named cross-file references from a file: imports, extends, implements,
   * calls, new-expressions, decorator usages, and type references.
   * The file must have been added to the ts-morph project first (via parseFile or lazy load).
   * @param filePath - Absolute path to the file.
   * @param knownSymbolNames - Set of all project symbol names; calls to names outside this set are ignored.
   * @returns Array of NamedRef edges ready for database resolution.
   * @throws {IndexError} - When reference extraction fails.
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
          sourceParentName: null,
          targetName: firstName, targetFile: resolved,
          targetParentName: null,
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
            sourceParentName: null,
            targetName: baseName, targetFile: importMap.get(baseName) ?? null,
            targetParentName: null,
            ref_kind: 'extends', source_line: cls.getStartLineNumber(), confidence: 'direct'
          });
        }
        for (const impl of cls.getImplements()) {
          const ifaceName = impl.getExpression().getText();
          refs.push({
            sourceName: className, sourceFile: filePath,
            sourceParentName: null,
            targetName: ifaceName, targetFile: importMap.get(ifaceName) ?? null,
            targetParentName: null,
            ref_kind: 'implements', source_line: cls.getStartLineNumber(), confidence: 'direct'
          });
        }
      }

      // calls edges — traverse all CallExpression nodes
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
        const calleeName = this.getCalleeName(call);
        if (!calleeName || !knownSymbolNames.has(calleeName)) continue;
        const enclosing = this.getEnclosingContext(call);
        if (!enclosing) continue;
        const targetFile = importMap.get(calleeName) ?? this.resolveLocalTargetFile(sourceFile, filePath, calleeName);
        refs.push({
          sourceName: enclosing.name, sourceFile: filePath,
          sourceParentName: enclosing.parentClassName,
          targetName: calleeName, targetFile,
          targetParentName: enclosing.isThisCall ? enclosing.parentClassName : null,
          ref_kind: 'calls', source_line: call.getStartLineNumber(), confidence: 'direct'
        });
      }

      // new expressions — capture constructor calls (NewExpression is distinct from CallExpression)
      for (const newExpr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as NewExpression[]) {
        const calleeName = newExpr.getExpression().getText();
        if (!knownSymbolNames.has(calleeName)) continue;
        const enclosing = this.getEnclosingContext(newExpr);
        if (!enclosing) continue;
        refs.push({
          sourceName: enclosing.name, sourceFile: filePath,
          sourceParentName: enclosing.parentClassName,
          targetName: calleeName, targetFile: importMap.get(calleeName) ?? this.resolveLocalTargetFile(sourceFile, filePath, calleeName),
          targetParentName: null,
          ref_kind: 'calls', source_line: newExpr.getStartLineNumber(), confidence: 'direct'
        });
      }

      for (const decorator of sourceFile.getDescendantsOfKind(SyntaxKind.Decorator) as Decorator[]) {
        const decoratorName = this.getDecoratorName(decorator);
        if (!decoratorName || !knownSymbolNames.has(decoratorName)) continue;
        const enclosing = this.getEnclosingContext(decorator);
        if (!enclosing) continue;
        refs.push({
          sourceName: enclosing.name,
          sourceFile: filePath,
          sourceParentName: enclosing.parentClassName,
          targetName: decoratorName,
          targetFile: importMap.get(decoratorName) ?? this.resolveLocalTargetFile(sourceFile, filePath, decoratorName),
          targetParentName: null,
          ref_kind: 'decorator',
          source_line: decorator.getStartLineNumber(),
          confidence: 'direct'
        });
      }

      for (const typeRef of sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference) as TypeReferenceNode[]) {
        const typeName = typeRef.getTypeName().getText().split('.').pop() ?? null;
        if (!typeName || !knownSymbolNames.has(typeName)) continue;
        const enclosing = this.getEnclosingContext(typeRef);
        if (!enclosing) continue;
        refs.push({
          sourceName: enclosing.name,
          sourceFile: filePath,
          sourceParentName: enclosing.parentClassName,
          targetName: typeName,
          targetFile: importMap.get(typeName) ?? this.resolveLocalTargetFile(sourceFile, filePath, typeName),
          targetParentName: null,
          ref_kind: 'type_ref',
          source_line: typeRef.getStartLineNumber(),
          confidence: 'direct'
        });
      }

      this.logDebug(LogEvents.PARSER_REFS_EXTRACTED, { filePath, count: refs.length });
      return refs;
    } catch (err) {
      throw new IndexError(`Failed to extract references from ${filePath}`, { cause: String(err), filePath });
    }
  }

  /**
   * @description Extracts all resolved import file paths from a source file.
   * Used to populate the file_imports table for graph traversal.
   * @param filePath - Absolute path to the source file.
   * @returns Unique array of absolute paths for files this source file imports.
   * @throws {IndexError} - When import extraction fails.
   */
  extractFileImports(filePath: string): string[] {
    try {
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        if (!existsSync(filePath)) return [];
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }

      const imports = new Set<string>();
      for (const imp of sourceFile.getImportDeclarations()) {
        const resolved = this.resolveImportPath(filePath, imp.getModuleSpecifierValue());
        if (resolved) imports.add(resolved);
      }
      return [...imports];
    } catch (err) {
      throw new IndexError(`Failed to extract file imports from ${filePath}`, { cause: String(err), filePath });
    }
  }

  /**
   * @description Builds a map of imported name to resolved absolute file path
   * from all import declarations in a source file.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path of the source file (used for relative resolution).
   * @returns Map from imported identifier name to its resolved absolute file path.
   */
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

  /**
   * @description Resolves a relative import specifier to an absolute .ts file path.
   * Returns null for bare module specifiers (node_modules) or paths that cannot be resolved.
   * @param sourceFile - Absolute path of the importing file.
   * @param specifier - The raw module specifier string (e.g. './utils' or '../types/common').
   * @returns Resolved absolute file path, or null when unresolvable.
   */
  private resolveImportPath(sourceFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = join(dirname(sourceFile), specifier);
    for (const suffix of ['.ts', '/index.ts', '.tsx', '/index.tsx']) {
      const full = base + suffix;
      if (existsSync(full)) return full;
    }
    return null;
  }

  /**
   * @description Extracts the callee name from a CallExpression.
   * Returns the last property-access segment for chained calls like obj.method().
   * @param call - The ts-morph CallExpression node to inspect.
   * @returns Callee identifier name, or null when the expression shape is unsupported.
   */
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

  /**
   * @description Walks up the AST ancestors of a node to find the enclosing method, function,
   * constructor, or class declaration that forms the reference source context.
   * @param node - Any ts-morph Node inside the source file.
   * @returns Enclosing context with name, optional parent class name, and this-call flag;
   * or null when the node sits outside any named declaration.
   */
  private getEnclosingContext(node: Node): { name: string; parentClassName: string | null; isThisCall: boolean } | null {
    const parentClass = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) as ClassDeclaration | undefined;
    const parentClassName = parentClass?.getName() ?? null;
    const isThisCall = node.getText().includes('this.');

    for (const ancestor of node.getAncestors()) {
      const kind = ancestor.getKindName();
      if (kind === 'MethodDeclaration') return { name: (ancestor as MethodDeclaration).getName(), parentClassName, isThisCall };
      if (kind === 'GetAccessor') return { name: (ancestor as GetAccessorDeclaration).getName(), parentClassName, isThisCall };
      if (kind === 'SetAccessor') return { name: (ancestor as SetAccessorDeclaration).getName(), parentClassName, isThisCall };
      if (kind === 'FunctionDeclaration') {
        const functionName = (ancestor as FunctionDeclaration).getName();
        if (!functionName) continue;
        return { name: functionName, parentClassName, isThisCall };
      }
      if (kind === 'Constructor') return { name: 'constructor', parentClassName, isThisCall };
      if (kind === 'ClassDeclaration') return { name: (ancestor as ClassDeclaration).getName() ?? '<anonymous>', parentClassName: null, isThisCall };
    }
    return null;
  }

  /**
   * @description Checks whether a symbol name is declared locally within the source file.
   * Used as a fallback when the import map has no entry for the target symbol.
   * @param sourceFile - The ts-morph SourceFile to search.
   * @param filePath - Absolute path of the source file, returned as the target when found.
   * @param symbolName - Symbol name to search for in the file's descendants.
   * @returns The file path when the symbol is declared locally, or null otherwise.
   */
  private resolveLocalTargetFile(sourceFile: SourceFile, filePath: string, symbolName: string): string | null {
    const localMatch = sourceFile.getDescendants().some(node => {
      const candidate = node as unknown as { getName?: () => string | undefined };
      return typeof candidate.getName === 'function' && candidate.getName() === symbolName;
    });
    return localMatch ? filePath : null;
  }

  /**
   * @description Extracts the decorator identifier from a Decorator node,
   * stripping call-expression parentheses and returning the last segment for
   * namespaced decorators like Ns.Decorator.
   * @param decorator - The ts-morph Decorator node to inspect.
   * @returns Decorator name, or null when the name cannot be determined.
   */
  private getDecoratorName(decorator: Decorator): string | null {
    const text = decorator.getExpression().getText();
    const normalized = text.replace(/\(\)$/, '');
    return normalized.split('.').pop() ?? null;
  }

  /**
   * @description Extracts all class declarations and their members (methods, getters, setters,
   * constructors, and properties) from the source file into the symbols accumulator.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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
      for (const getter of cls.getGetAccessors()) {
        symbols.push({
          name: getter.getName(), kind: 'getter', file_path: filePath,
          line: getter.getStartLineNumber(), column: 0, end_line: getter.getEndLineNumber(),
          parent_id: null,
          signature: getter.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
          modifiers: this.getMods(getter),
          return_type: getter.getReturnType().getText(),
          params: null,
          doc_comment: this.getDoc(getter), _parentName: name
        });
      }
      for (const setter of cls.getSetAccessors()) {
        symbols.push({
          name: setter.getName(), kind: 'setter', file_path: filePath,
          line: setter.getStartLineNumber(), column: 0, end_line: setter.getEndLineNumber(),
          parent_id: null,
          signature: setter.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
          modifiers: this.getMods(setter),
          return_type: null,
          params: setter.getParameters().map(p => p.getText()).join(', '),
          doc_comment: this.getDoc(setter), _parentName: name
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

  /**
   * @description Extracts all interface declarations from the source file.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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

  /**
   * @description Extracts all top-level function declarations from the source file.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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

  /**
   * @description Extracts all enum declarations and their members from the source file.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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

  /**
   * @description Extracts all type alias declarations from the source file.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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

  /**
   * @description Extracts exported variable declarations from the source file.
   * Only exported variables are included; unexported constants and locals are ignored.
   * @param sourceFile - The ts-morph SourceFile to scan.
   * @param filePath - Absolute path used to populate file_path on each symbol.
   * @param symbols - Accumulator array that receives the extracted TsaSymbol entries.
   */
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

  /**
   * @description Collects modifier keywords (export, abstract, async, static) from an AST node
   * using duck-typed method calls to stay compatible with the diverse ts-morph node hierarchy.
   * @param node - Any ts-morph AST node that may expose modifier accessor methods.
   * @returns Space-separated modifier string, or an empty string when none apply.
   */
  private getMods(node: unknown): string {
    const n = node as Record<string, unknown>;
    const mods: string[] = [];
    if (typeof n['isExported'] === 'function' && (n['isExported'] as () => boolean)()) mods.push('export');
    if (typeof n['isAbstract'] === 'function' && (n['isAbstract'] as () => boolean)()) mods.push('abstract');
    if (typeof n['isAsync'] === 'function' && (n['isAsync'] as () => boolean)()) mods.push('async');
    if (typeof n['isStatic'] === 'function' && (n['isStatic'] as () => boolean)()) mods.push('static');
    return mods.join(' ');
  }

  /**
   * @description Reads the JSDoc comment text from an AST node that exposes getJsDocs().
   * @param node - Any ts-morph AST node that may carry JSDoc comments.
   * @returns Concatenated JSDoc comment text, or null when none is present.
   */
  private getDoc(node: unknown): string | null {
    const n = node as Record<string, unknown>;
    if (typeof n['getJsDocs'] !== 'function') return null;
    const docs = (n['getJsDocs'] as () => Array<{ getComment: () => string | undefined }>)();
    if (!docs.length) return null;
    return docs.map(d => d.getComment()).filter(Boolean).join('\n') || null;
  }
}
