/**
 * @file SymbolService.ts
 * @description Layer 2 symbol query service exposing find_symbol, search_symbols,
 * get_methods, and get_file_symbols against the indexed symbol database.
 * @module services
 */
import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult, SymbolKind } from '../types/common';
import type { SymbolRow } from '../database/types';

/**
 * @description Input contract for find_symbol.
 */
interface FindSymbolInput { name: string; kind?: SymbolKind; }

/**
 * @description Input contract for search_symbols.
 */
interface SearchSymbolsInput { query: string; kind?: SymbolKind; limit?: number; }

/**
 * @description Input contract for get_methods.
 */
interface GetMethodsInput { class_name: string; }

/**
 * @description Input contract for get_file_symbols.
 */
interface GetFileSymbolsInput { file_path: string; kind?: SymbolKind; }

/**
 * @description Compact symbol record returned by all symbol query tools.
 */
export interface SymbolResult {
  /** Declared name of the symbol. */
  name: string;
  /** Symbol kind (class, function, method, interface, etc.). */
  kind: string;
  /** Absolute path to the file containing the symbol. */
  file_path: string;
  /** 1-based line number of the declaration. */
  line: number;
  /** Type signature, or null when not available. */
  signature: string | null;
  /** Space-separated modifier keywords (e.g. "public static"). */
  modifiers: string;
}

/**
 * @description Provides symbol lookup and search operations over the TSA index.
 * @class SymbolService
 * @example
 * const symbolService = new SymbolService(dbService);
 * const result = symbolService.findSymbol({ name: 'UserController' });
 */
export class SymbolService extends BaseService {
  private readonly db: DatabaseService;

  /**
   * @description Creates a new SymbolService backed by the provided database connection.
   * @param db - DatabaseService instance used for all symbol queries.
   */
  constructor(db: DatabaseService) {
    super('SymbolService');
    this.db = db;
  }

  /**
   * @description Finds symbols by exact name, optionally filtered by kind.
   * @param input - Find request containing a symbol name and optional kind filter.
   * @returns Compact symbol results matching the requested name.
   */
  findSymbol(input: FindSymbolInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.querySymbolsByName(input.name, input.kind);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'find_symbol', name: input.name });
    return this.buildResult(rows, start);
  }

  /**
   * @description Searches symbols by partial name prefix using the index's full-text search.
   * @param input - Search request containing a query string and optional kind filter and limit.
   * @returns Compact symbol results ranked by relevance, capped at the requested limit.
   */
  searchSymbols(input: SearchSymbolsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.searchSymbols(input.query, input.kind, input.limit ?? 20);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'search_symbols', query: input.query });
    return this.buildResult(rows, start);
  }

  /**
   * @description Returns all indexed methods and class members for the named class.
   * @param input - Request containing the class name to look up.
   * @returns Compact symbol results scoped to the class's methods and members.
   */
  getMethods(input: GetMethodsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.getMethodsByClassName(input.class_name);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_methods', class_name: input.class_name });
    return this.buildResult(rows, start);
  }

  /**
   * @description Returns all indexed symbols in the given file, optionally filtered to a single kind.
   * @param input - Request containing an absolute file path and optional kind filter.
   * @returns Compact symbol results for every matching symbol declared in the file.
   */
  getFileSymbols(input: GetFileSymbolsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.getSymbolsByFile(input.file_path, input.kind);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_file_symbols', file_path: input.file_path });
    return this.buildResult(rows, start);
  }

  /**
   * @description Converts raw symbol rows into the compact ToolResult shape with timing metadata.
   * @param rows - Raw symbol rows from the database.
   * @param startMs - Timestamp (ms) captured before the database query began.
   * @returns Shaped tool result with results array and timing metadata.
   */
  private buildResult(rows: SymbolRow[], startMs: number): ToolResult<SymbolResult> {
    return {
      results: rows.map(r => ({
        name: r.name, kind: r.kind, file_path: r.file_path,
        line: r.line, signature: r.signature, modifiers: r.modifiers
      })),
      _meta: { count: rows.length, query_ms: Date.now() - startMs, correlationId: randomUUID() }
    };
  }
}
