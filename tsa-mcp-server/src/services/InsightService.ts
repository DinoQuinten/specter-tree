/**
 * @file InsightService.ts
 * @description High-signal insight tools that reduce exploratory reads by summarizing files,
 * resolving barrel exports, and ranking likely edit targets.
 * @module services
 */
import { randomUUID } from 'node:crypto';
import { Project, SyntaxKind, type ExportedDeclarations, type SourceFile } from 'ts-morph';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { FrameworkService } from './FrameworkService';
import type { SymbolKind, ToolMeta } from '../types/common';
import type { SymbolRow } from '../database/types';

/**
 * @description Input contract for summarize_file_structure.
 */
interface SummarizeFileStructureInput {
  file_path: string;
}

/**
 * @description Input contract for resolve_exports.
 */
interface ResolveExportsInput {
  file_path: string;
  export_name: string;
}

/**
 * @description Input contract for find_write_targets.
 */
interface FindWriteTargetsInput {
  symbol_name: string;
  class_name?: string;
  limit?: number;
}

/**
 * @description Input contract for explain_flow.
 */
interface ExplainFlowInput {
  symbol_name?: string;
  file_path?: string;
  route_path?: string;
  class_name?: string;
  max_depth?: number;
}

/**
 * @description Compact class summary for file-level overviews.
 */
export interface FileClassSummary {
  name: string;
  members: string[];
}

/**
 * @description Token-efficient file summary returned by summarize_file_structure.
 */
export interface FileStructureSummary {
  file_path: string;
  exports: string[];
  classes: FileClassSummary[];
  functions: string[];
  interfaces: string[];
  type_aliases: string[];
  enums: string[];
  imports_from: string[];
  side_effect_imports: string[];
  has_top_level_effects: boolean;
  _meta: ToolMeta;
}

/**
 * @description One step in an export-resolution chain.
 */
export interface ExportResolutionHop {
  file_path: string;
  exported_as: string;
}

/**
 * @description Final resolution details for a named export.
 */
export interface ExportResolution {
  export_name: string;
  resolved_symbol_name: string;
  resolved_file_path: string;
  line: number;
  hops: ExportResolutionHop[];
  _meta: Omit<ToolMeta, 'count'>;
}

/**
 * @description Ranked file location that is likely to require edits for a requested change.
 */
export interface WriteTarget {
  reason: 'declaration' | 'caller' | 'implementor' | 'subclass';
  file_path: string;
  line: number;
  symbol_name: string;
  kind: string;
  score: number;
}

/**
 * @description Ranked edit-target list returned by find_write_targets.
 */
export interface WriteTargetsResult {
  targets: WriteTarget[];
  _meta: ToolMeta;
}

/**
 * @description One hop in a compact structural flow.
 */
export interface FlowHop {
  kind: 'symbol' | 'middleware' | 'route_handler' | 'call';
  name: string;
  file_path: string;
  line: number;
}

/**
 * @description Ranked structural path returned by explain_flow.
 */
export interface FlowPath {
  summary: string;
  hops: FlowHop[];
}

/**
 * @description Bounded path set returned by explain_flow.
 */
export interface ExplainFlowResult {
  paths: FlowPath[];
  _warnings?: string[];
  _meta: ToolMeta;
}

/**
 * @description Builds compact file insights and edit-target suggestions from the indexed graph
 * plus lightweight AST reads for export-aware operations.
 * @example
 * const insightService = new InsightService(projectRoot, dbService);
 * const summary = insightService.summarizeFileStructure({ file_path: '/repo/src/index.ts' });
 */
export class InsightService extends BaseService {
  private readonly db: DatabaseService;
  private readonly project: Project;
  private readonly framework: FrameworkService;

  constructor(_projectRoot: string, db: DatabaseService, framework: FrameworkService) {
    super('InsightService');
    this.db = db;
    this.framework = framework;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * @description Returns a compact structural summary for a file so agents can decide
   * whether a full read is necessary.
   * @param input - File summary request with an absolute path.
   * @returns File-level summary including exports, declarations, imports, and top-level effects.
   * @throws {Error} - When the file cannot be parsed by ts-morph.
   */
  summarizeFileStructure(input: SummarizeFileStructureInput): FileStructureSummary {
    const start = Date.now();
    const rows = this.db.getSymbolsByFile(input.file_path);
    const sourceFile = this.loadSourceFile(input.file_path);
    const exports = [...sourceFile.getExportedDeclarations().keys()].sort();
    const sideEffectImports = sourceFile.getImportDeclarations()
      .filter(imp => !imp.getDefaultImport() && imp.getNamedImports().length === 0 && !imp.getNamespaceImport())
      .map(imp => imp.getModuleSpecifierValue())
      .sort();
    // Treat declarations as safe structure and flag anything else as a likely top-level effect.
    const hasTopLevelEffects = sourceFile.getStatements().some(statement => {
      const kind = statement.getKind();
      return ![
        SyntaxKind.ImportDeclaration,
        SyntaxKind.ExportDeclaration,
        SyntaxKind.InterfaceDeclaration,
        SyntaxKind.TypeAliasDeclaration,
        SyntaxKind.ClassDeclaration,
        SyntaxKind.FunctionDeclaration,
        SyntaxKind.EnumDeclaration,
        SyntaxKind.VariableStatement
      ].includes(kind);
    });

    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'summarize_file_structure', file_path: input.file_path });
    return {
      file_path: input.file_path,
      exports,
      classes: rows
        .filter(row => row.kind === 'class')
        .map(cls => ({
          name: cls.name,
          members: rows
            // Only surface edit-relevant class entry points, not backing fields.
            .filter(row => row.parent_id === cls.id && ['method', 'constructor', 'getter', 'setter'].includes(row.kind))
            .map(row => row.name)
            .sort()
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      functions: this.collectNames(rows, 'function'),
      interfaces: this.collectNames(rows, 'interface'),
      type_aliases: this.collectNames(rows, 'type_alias'),
      enums: this.collectNames(rows, 'enum'),
      imports_from: this.db.getRelatedFiles(input.file_path).imports_from.sort(),
      side_effect_imports: sideEffectImports,
      has_top_level_effects: hasTopLevelEffects,
      _meta: {
        count: rows.length,
        query_ms: Date.now() - start,
        correlationId: randomUUID()
      }
    };
  }

  /**
   * @description Resolves a named export from a module or barrel file to the declaration
   * that ultimately owns it.
   * @param input - Export-resolution request with the exporting file and named export.
   * @returns The resolved declaration location, or null when the export is not present.
   * @throws {Error} - When the exporting file cannot be parsed by ts-morph.
   */
  resolveExports(input: ResolveExportsInput): ExportResolution | null {
    const start = Date.now();
    const sourceFile = this.loadSourceFile(input.file_path);
    const exported = sourceFile.getExportedDeclarations().get(input.export_name);
    if (!exported || exported.length === 0) return null;

    const resolved = exported[0]!;
    const resolvedName = this.getDeclarationName(resolved) ?? input.export_name;

    this.logDebug(LogEvents.TOOL_CALLED, {
      tool: 'resolve_exports',
      file_path: input.file_path,
      export_name: input.export_name
    });
    return {
      export_name: input.export_name,
      resolved_symbol_name: resolvedName,
      resolved_file_path: resolved.getSourceFile().getFilePath(),
      line: resolved.getStartLineNumber(),
      hops: [{ file_path: input.file_path, exported_as: input.export_name }],
      _meta: {
        query_ms: Date.now() - start,
        correlationId: randomUUID()
      }
    };
  }

  /**
   * @description Ranks likely edit locations for a requested symbol by combining declaration,
   * caller, implementor, and subclass relationships.
   * @param input - Symbol target request with optional class disambiguation and result limit.
   * @returns Ranked list of likely edit targets ordered by usefulness.
   * @throws {Error} - When indexed symbol lookups fail.
   */
  findWriteTargets(input: FindWriteTargetsInput): WriteTargetsResult {
    const start = Date.now();
    const symbolRows = input.class_name
      ? this.db.querySymbolsByNameAndParent(input.symbol_name, input.class_name)
      : this.db.querySymbolsByName(input.symbol_name);

    const targets = new Map<string, WriteTarget>();

    for (const row of symbolRows) {
      this.addTarget(targets, {
        reason: 'declaration',
        file_path: row.file_path,
        line: row.line,
        symbol_name: row.name,
        kind: row.kind,
        score: 100
      });

      for (const caller of this.db.getCallers(row.id)) {
        this.addTarget(targets, {
          reason: 'caller',
          file_path: caller.caller_file ?? 'unknown',
          line: caller.caller_line ?? 0,
          symbol_name: caller.caller_name ?? 'unknown',
          kind: caller.caller_class ? 'method' : 'function',
          score: 80
        });
      }

      if (row.kind === 'interface') {
        for (const implementor of this.db.getImplementors(row.id)) {
          this.addTarget(targets, {
            reason: 'implementor',
            file_path: implementor.file_path ?? 'unknown',
            line: 0,
            symbol_name: implementor.class_name ?? 'unknown',
            kind: 'class',
            score: 75
          });
        }
      }

      if (row.kind === 'class') {
        // Subclasses are often the next edit point when a base-class contract changes.
        const hierarchy = this.db.getHierarchyData(row.id);
        for (const subclass of hierarchy.extended_by) {
          this.addTarget(targets, {
            reason: 'subclass',
            file_path: subclass.file_path,
            line: subclass.line,
            symbol_name: subclass.name,
            kind: subclass.kind,
            score: 70
          });
        }
      }
    }

    const ordered = [...targets.values()]
      .sort((a, b) => b.score - a.score || a.file_path.localeCompare(b.file_path) || a.line - b.line)
      .slice(0, input.limit ?? 10);

    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'find_write_targets', symbol_name: input.symbol_name });
    return {
      targets: ordered,
      _meta: {
        count: ordered.length,
        query_ms: Date.now() - start,
        correlationId: randomUUID()
      }
    };
  }

  /**
   * @description Builds short structural paths from a symbol, file, or route entrypoint,
   * including middleware hops for route-based flows by default.
   * @param input - Flow request with exactly one entry selector and an optional traversal depth.
   * @returns Ranked compact paths intended to replace exploratory file reads.
   * @throws {Error} - When the request is ambiguous or the selected entrypoint cannot be resolved.
   */
  explainFlow(input: ExplainFlowInput): ExplainFlowResult {
    const start = Date.now();
    const selectors = [input.symbol_name, input.file_path, input.route_path].filter(Boolean);
    if (selectors.length !== 1) {
      throw new Error('explain_flow requires exactly one of symbol_name, file_path, or route_path');
    }

    const MAX_DEPTH_LIMIT = 4;
    const requestedDepth = input.max_depth ?? 3;
    const maxDepth = Math.max(1, Math.min(requestedDepth, MAX_DEPTH_LIMIT));
    const depthCapped = requestedDepth > MAX_DEPTH_LIMIT;

    const seedPaths = input.route_path
      ? this.buildRouteSeedPaths(input.route_path)
      : input.file_path
        ? this.buildFileSeedPaths(input.file_path)
        : this.buildSymbolSeedPaths(input.symbol_name!, input.class_name);

    const paths = seedPaths
      .flatMap(seed => this.expandFlow(seed, maxDepth))
      .slice(0, 3)
      .map(hops => ({
        summary: hops.map(hop => hop.name).join(' -> '),
        hops
      }));

    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'explain_flow' });
    return {
      paths,
      ...(depthCapped ? { _warnings: [`max_depth capped at ${MAX_DEPTH_LIMIT} (requested ${requestedDepth})`] } : {}),
      _meta: {
        count: paths.length,
        query_ms: Date.now() - start,
        correlationId: randomUUID()
      }
    };
  }

  /**
   * @description Reloads a source file into the local ts-morph project so repeated insight
   * queries always read the latest on-disk content.
   * @param filePath - Absolute path to the file that should be loaded.
   * @returns A fresh ts-morph SourceFile instance.
   */
  private loadSourceFile(filePath: string): SourceFile {
    const existing = this.project.getSourceFile(filePath);
    if (existing) this.project.removeSourceFile(existing);
    return this.project.addSourceFileAtPath(filePath);
  }

  /**
   * @description Collects sorted top-level symbol names for a specific symbol kind.
   * @param rows - Indexed symbols from a single file.
   * @param kind - Symbol kind to include in the result.
   * @returns Sorted list of top-level symbol names.
   */
  private collectNames(rows: SymbolRow[], kind: SymbolKind): string[] {
    return rows
      .filter(row => row.kind === kind && row.parent_id === null)
      .map(row => row.name)
      .sort();
  }

  /**
   * @description Keeps the highest-scoring version of a write target when multiple graph
   * paths point to the same file location.
   * @param store - Accumulator keyed by stable file location identity.
   * @param target - Candidate target to merge into the store.
   * @returns Nothing. The target map is updated in place.
   */
  private addTarget(store: Map<string, WriteTarget>, target: WriteTarget): void {
    const key = `${target.reason}:${target.file_path}:${target.line}:${target.symbol_name}`;
    const existing = store.get(key);
    if (!existing || existing.score < target.score) store.set(key, target);
  }

  /**
   * @description Reads a declaration name when the underlying ts-morph node exposes one.
   * @param declaration - Exported declaration candidate from ts-morph.
   * @returns Declaration name, or null when the node is anonymous.
   */
  private getDeclarationName(declaration: ExportedDeclarations): string | null {
    const candidate = declaration as unknown as { getName?: () => string | undefined };
    return typeof candidate.getName === 'function' ? candidate.getName() ?? null : null;
  }

  /**
   * @description Creates starting hops for a symbol-driven flow query.
   * @param symbolName - Symbol name requested by the caller.
   * @param className - Optional parent class used for method disambiguation.
   * @returns Seed paths, one per matching symbol.
   */
  private buildSymbolSeedPaths(symbolName: string, className?: string): FlowHop[][] {
    const rows = className
      ? this.db.querySymbolsByNameAndParent(symbolName, className)
      : this.db.querySymbolsByName(symbolName);

    return rows.map(row => [this.symbolRowToHop(row, 'symbol')]);
  }

  /**
   * @description Creates starting hops for a file-driven flow query by selecting top-level
   * functions and classes declared in the file.
   * @param filePath - File path requested by the caller.
   * @returns Seed paths rooted in the file's top-level declarations.
   */
  private buildFileSeedPaths(filePath: string): FlowHop[][] {
    const rows = this.db.getSymbolsByFile(filePath)
      .filter(row => row.parent_id === null && ['function', 'class'].includes(row.kind));

    if (rows.length === 0) {
      return [[{ kind: 'symbol', name: filePath.split(/[\\/]/).pop() ?? filePath, file_path: filePath, line: 1 }]];
    }

    return rows.map(row => [this.symbolRowToHop(row, 'symbol')]);
  }

  /**
   * @description Creates starting hops for a route-driven flow query, including middleware
   * before the route handler to preserve execution order.
   * @param routePath - Route path requested by the caller.
   * @returns Seed paths rooted at middleware and route handler hops.
   */
  private buildRouteSeedPaths(routePath: string): FlowHop[][] {
    const routeConfig = this.framework.getRouteConfig(routePath);
    if (!routeConfig) return [];

    const middleware = this.framework.traceMiddleware(routePath).traces.map(trace => ({
      kind: 'middleware' as const,
      name: trace.name,
      file_path: trace.file_path,
      line: trace.line
    }));

    const handlerRows = this.db.getSymbolsByFile(routeConfig.file_path)
      .filter(row => row.parent_id === null && ['function', 'method'].includes(row.kind));

    if (handlerRows.length === 0) {
      return [[...middleware, {
        kind: 'route_handler' as const,
        name: routeConfig.handler,
        file_path: routeConfig.file_path,
        line: 1
      }]];
    }

    return handlerRows.map(row => [
      ...middleware,
      this.symbolRowToHop(row, 'route_handler')
    ]);
  }

  /**
   * @description Expands a seed path through outbound call edges up to the requested depth.
   * @param seed - Initial hop sequence.
   * @param maxDepth - Maximum number of symbol-to-symbol expansion steps.
   * @returns Ranked compact hop sequences.
   */
  private expandFlow(seed: FlowHop[], maxDepth: number): FlowHop[][] {
    const last = seed[seed.length - 1]!;
    const symbolRows = this.db.querySymbolsByName(last.name);
    const baseRow = symbolRows.find(row => row.file_path === last.file_path) ?? symbolRows[0];
    if (!baseRow) return [seed];

    const visited = new Set<string>([`${baseRow.file_path}:${baseRow.name}:${baseRow.line}`]);
    const queue: Array<{ row: SymbolRow; hops: FlowHop[]; depth: number }> = [{
      row: baseRow,
      hops: seed,
      depth: 0
    }];
    const results: FlowHop[][] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const callers = this.getOutboundTargets(current.row);
      if (current.hops.length >= maxDepth || callers.length === 0) {
        results.push(current.hops);
        continue;
      }

      for (const target of callers) {
        const key = `${target.file_path}:${target.name}:${target.line}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({
          row: target,
          hops: [...current.hops, this.symbolRowToHop(target, 'call')],
          depth: current.depth + 1
        });
      }
    }

    return results.length > 0 ? results : [seed];
  }

  /**
   * @description Resolves direct outbound call targets for a symbol by following call edges
   * recorded in the references table.
   * @param row - Source symbol row.
   * @returns Directly connected callee symbols.
   */
  private getOutboundTargets(row: SymbolRow): SymbolRow[] {
    const references = this.db.getOutgoingReferences(row.id, 'calls');
    return references
      .map(ref => this.db.getSymbolById(ref.target_symbol_id))
      .filter((candidate): candidate is SymbolRow => candidate !== null);
  }

  /**
   * @description Converts an indexed symbol row into a compact flow hop.
   * @param row - Indexed symbol row.
   * @param kind - Flow hop kind to assign.
   * @returns Compact flow hop.
   */
  private symbolRowToHop(row: SymbolRow, kind: 'symbol' | 'route_handler' | 'call'): FlowHop {
    return {
      kind,
      name: row.name,
      file_path: row.file_path,
      line: row.line
    };
  }
}
