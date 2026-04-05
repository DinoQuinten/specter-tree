/**
 * @file ReferenceService.ts
 * @description Layer 2 call-graph service exposing get_callers, get_implementations,
 * get_hierarchy, and get_related_files against the indexed reference database.
 * @module services
 */
import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult } from '../types/common';

/**
 * @description Input contract for get_callers.
 */
interface GetCallersInput { symbol_name: string; class_name?: string; }

/**
 * @description Input contract for get_implementations.
 */
interface GetImplementationsInput { interface_name: string; }

/**
 * @description Input contract for get_hierarchy.
 */
interface GetHierarchyInput { class_name: string; }

/**
 * @description Input contract for get_related_files.
 */
interface GetRelatedFilesInput { file_path: string; }

/**
 * @description A single call-site that invokes the queried symbol.
 */
export interface CallerResult {
  /** Name of the calling function or method. */
  caller_name: string;
  /** Containing class name, or null for module-level callers. */
  caller_class: string | null;
  /** Absolute path to the file containing the call site. */
  caller_file: string;
  /** 1-based line number of the call expression. */
  line: number;
  /** Index confidence level for this edge (e.g. "high", "best-effort"). */
  confidence: string;
}

/**
 * @description A class that implements a queried interface.
 */
export interface ImplementorResult {
  /** Name of the implementing class. */
  class_name: string;
  /** Absolute path to the file declaring the class. */
  file_path: string;
  /** 1-based line number of the class declaration. */
  line: number;
}

/**
 * @description A single entry in a class hierarchy list.
 */
export interface HierarchyEntry {
  /** Declared name of the class or interface. */
  name: string;
  /** Absolute path to the file containing the declaration. */
  file_path: string;
  /** 1-based line number of the declaration. */
  line: number;
}

/**
 * @description Full inheritance and implementation hierarchy for a class.
 */
export interface HierarchyResult {
  /** Classes or interfaces this class directly extends. */
  extends: HierarchyEntry[];
  /** Interfaces this class directly implements. */
  implements: HierarchyEntry[];
  /** Classes that directly extend this class. */
  extended_by: HierarchyEntry[];
  /** Classes that directly implement this class (when it is an interface). */
  implemented_by: HierarchyEntry[];
  /** Timing and correlation metadata. */
  _meta: { query_ms: number; correlationId: string };
}

/**
 * @description Import graph for a file, listing its upstream and downstream dependencies.
 */
export interface RelatedFilesResult {
  /** Absolute paths of files this file imports. */
  imports_from: string[];
  /** Absolute paths of files that import this file. */
  imported_by: string[];
  /** Timing and correlation metadata. */
  _meta: { query_ms: number; correlationId: string };
}

/**
 * @description Provides call-graph reference and hierarchy queries over the TSA index.
 * @class ReferenceService
 * @example
 * const referenceService = new ReferenceService(dbService);
 * const callers = referenceService.getCallers({ symbol_name: 'handleRequest' });
 */
export class ReferenceService extends BaseService {
  private readonly db: DatabaseService;

  /**
   * @description Creates a new ReferenceService backed by the provided database connection.
   * @param db - DatabaseService instance used for all reference queries.
   */
  constructor(db: DatabaseService) {
    super('ReferenceService');
    this.db = db;
  }

  /**
   * @description Returns all indexed call sites that invoke the named symbol,
   * deduplicated across multiple matching declarations.
   * @param input - Request containing a symbol name and optional class disambiguation.
   * @returns Caller results with confidence level and a best-effort accuracy warning.
   */
  getCallers(input: GetCallersInput): ToolResult<CallerResult> {
    const start = Date.now();
    const symbolRows = input.class_name
      ? this.db.querySymbolsByNameAndParent(input.symbol_name, input.class_name, 'method')
      : this.db.querySymbolsByName(input.symbol_name);
    if (symbolRows.length === 0) {
      return { results: [], _meta: { count: 0, query_ms: Date.now() - start, correlationId: randomUUID() } };
    }
    const rows = symbolRows.flatMap(target => this.db.getCallers(target.id));
    const deduped = rows.filter((row, index, all) =>
      all.findIndex(candidate =>
        candidate.caller_name === row.caller_name &&
        candidate.caller_file === row.caller_file &&
        candidate.caller_line === row.caller_line &&
        candidate.caller_class === row.caller_class
      ) === index
    );
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_callers', symbol: input.symbol_name });
    return {
      results: deduped.map(r => ({
        caller_name: r.caller_name ?? 'unknown', caller_class: r.caller_class ?? null,
        caller_file: r.caller_file ?? 'unknown', line: r.caller_line ?? 0, confidence: r.confidence
      })),
      _warnings: ['Call graph is best-effort. DI, dynamic dispatch, and higher-order functions may be missing.'],
      _meta: { count: deduped.length, query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * @description Returns all classes that implement the named interface, deduplicated
   * across multiple matching interface declarations.
   * @param input - Request containing the interface name to look up.
   * @returns Implementor results listing each implementing class and its file location.
   */
  getImplementations(input: GetImplementationsInput): ToolResult<ImplementorResult> {
    const start = Date.now();
    const ifaceRows = this.db.querySymbolsByName(input.interface_name, 'interface');
    if (ifaceRows.length === 0) {
      return { results: [], _meta: { count: 0, query_ms: Date.now() - start, correlationId: randomUUID() } };
    }
    const rows = ifaceRows.flatMap(iface => this.db.getImplementors(iface.id));
    const deduped = rows.filter((row, index, all) =>
      all.findIndex(candidate => candidate.class_name === row.class_name && candidate.file_path === row.file_path) === index
    );
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_implementations', interface: input.interface_name });
    return {
      results: deduped.map(r => ({ class_name: r.class_name ?? 'unknown', file_path: r.file_path ?? 'unknown', line: 0 })),
      _meta: { count: deduped.length, query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * @description Returns the full inheritance and implementation hierarchy for a class,
   * merging data from all matching class declarations.
   * @param input - Request containing the class name to look up.
   * @returns Deduplicated hierarchy entries for ancestors, descendants, and implementors.
   */
  getHierarchy(input: GetHierarchyInput): HierarchyResult {
    const start = Date.now();
    const classRows = this.db.querySymbolsByName(input.class_name, 'class');
    if (classRows.length === 0) {
      return { extends: [], implements: [], extended_by: [], implemented_by: [], _meta: { query_ms: Date.now() - start, correlationId: randomUUID() } };
    }
    const merged = classRows.reduce((acc, row) => {
      const data = this.db.getHierarchyData(row.id);
      acc.extends.push(...data.extends);
      acc.implements.push(...data.implements);
      acc.extended_by.push(...data.extended_by);
      acc.implemented_by.push(...data.implemented_by);
      return acc;
    }, { extends: [] as HierarchyEntry[], implements: [] as HierarchyEntry[], extended_by: [] as HierarchyEntry[], implemented_by: [] as HierarchyEntry[] });
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_hierarchy', class: input.class_name });
    const toEntry = (r: { name: string; file_path: string; line: number }): HierarchyEntry => ({ name: r.name, file_path: r.file_path, line: r.line });
    const unique = (entries: HierarchyEntry[]): HierarchyEntry[] => entries.filter((entry, index, all) =>
      all.findIndex(candidate => candidate.name === entry.name && candidate.file_path === entry.file_path && candidate.line === entry.line) === index
    );
    return {
      extends: unique(merged.extends.map(toEntry)), implements: unique(merged.implements.map(toEntry)),
      extended_by: unique(merged.extended_by.map(toEntry)), implemented_by: unique(merged.implemented_by.map(toEntry)),
      _meta: { query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * @description Returns the import graph edges for a file: the files it imports and the
   * files that import it.
   * @param input - Request containing the absolute file path to look up.
   * @returns Bidirectional import graph entries with timing metadata.
   */
  getRelatedFiles(input: GetRelatedFilesInput): RelatedFilesResult {
    const start = Date.now();
    const data = this.db.getRelatedFiles(input.file_path);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_related_files', file: input.file_path });
    return { ...data, _meta: { query_ms: Date.now() - start, correlationId: randomUUID() } };
  }
}
