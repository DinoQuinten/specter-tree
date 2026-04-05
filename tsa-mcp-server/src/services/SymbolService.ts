import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult, SymbolKind } from '../types/common';
import type { SymbolRow } from '../database/types';

interface FindSymbolInput { name: string; kind?: SymbolKind; }
interface SearchSymbolsInput { query: string; kind?: SymbolKind; limit?: number; }
interface GetMethodsInput { class_name: string; }
interface GetFileSymbolsInput { file_path: string; kind?: SymbolKind; }

export interface SymbolResult {
  name: string; kind: string; file_path: string; line: number;
  signature: string | null; modifiers: string;
}

/**
 * @class SymbolService
 * @description Handles Layer 2 symbol query tools: find_symbol, search_symbols, get_methods, get_file_symbols.
 */
export class SymbolService extends BaseService {
  private readonly db: DatabaseService;

  /** @param db DatabaseService instance */
  constructor(db: DatabaseService) {
    super('SymbolService');
    this.db = db;
  }

  /**
   * Find symbols by exact name, optionally filtered by kind.
   * @param input find_symbol tool input
   * @returns Compact symbol results
   */
  findSymbol(input: FindSymbolInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.querySymbolsByName(input.name, input.kind);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'find_symbol', name: input.name });
    return this.buildResult(rows, start);
  }

  /**
   * Search symbols by partial name.
   * @param input search_symbols tool input
   * @returns Compact symbol results
   */
  searchSymbols(input: SearchSymbolsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.searchSymbols(input.query, input.kind, input.limit ?? 20);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'search_symbols', query: input.query });
    return this.buildResult(rows, start);
  }

  /**
   * Get all methods and members of a class.
   * @param input get_methods tool input
   * @returns Compact method results
   */
  getMethods(input: GetMethodsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.getMethodsByClassName(input.class_name);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_methods', class_name: input.class_name });
    return this.buildResult(rows, start);
  }

  /**
   * Get all symbols in a file, optionally filtered by kind.
   * @param input get_file_symbols tool input
   * @returns Compact symbol results
   */
  getFileSymbols(input: GetFileSymbolsInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.getSymbolsByFile(input.file_path, input.kind);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_file_symbols', file_path: input.file_path });
    return this.buildResult(rows, start);
  }

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
