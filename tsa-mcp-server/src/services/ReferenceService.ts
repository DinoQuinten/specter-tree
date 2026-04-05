import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult } from '../types/common';

interface GetCallersInput { symbol_name: string; class_name?: string; }
interface GetImplementationsInput { interface_name: string; }
interface GetHierarchyInput { class_name: string; }
interface GetRelatedFilesInput { file_path: string; }

export interface CallerResult { caller_name: string; caller_class: string | null; caller_file: string; line: number; confidence: string; }
export interface ImplementorResult { class_name: string; file_path: string; line: number; }
export interface HierarchyEntry { name: string; file_path: string; line: number; }
export interface HierarchyResult {
  extends: HierarchyEntry[]; implements: HierarchyEntry[];
  extended_by: HierarchyEntry[]; implemented_by: HierarchyEntry[];
  _meta: { query_ms: number; correlationId: string };
}
export interface RelatedFilesResult {
  imports_from: string[]; imported_by: string[];
  _meta: { query_ms: number; correlationId: string };
}

/**
 * @class ReferenceService
 * @description Handles Layer 2 call graph tools: get_callers, get_implementations, get_hierarchy, get_related_files.
 */
export class ReferenceService extends BaseService {
  private readonly db: DatabaseService;

  /** @param db DatabaseService instance */
  constructor(db: DatabaseService) {
    super('ReferenceService');
    this.db = db;
  }

  /**
   * Get all callers of a named symbol.
   * @param input get_callers tool input
   * @returns Caller results with confidence level and best-effort warning
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
   * Get all classes that implement a given interface.
   * @param input get_implementations tool input
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
   * Get full inheritance/implementation hierarchy for a class.
   * @param input get_hierarchy tool input
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
   * Get files this file imports from and files that import this file.
   * @param input get_related_files tool input
   */
  getRelatedFiles(input: GetRelatedFilesInput): RelatedFilesResult {
    const start = Date.now();
    const data = this.db.getRelatedFiles(input.file_path);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_related_files', file: input.file_path });
    return { ...data, _meta: { query_ms: Date.now() - start, correlationId: randomUUID() } };
  }
}
