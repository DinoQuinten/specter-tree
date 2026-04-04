import type { Database } from 'bun:sqlite';
import { BaseService } from './BaseService';
import { QueryError } from '../errors/QueryError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, TsaReference, FileRecord } from '../types/common';
import type { SymbolRow, ReferenceRow, FileRow } from '../database/types';
import { SCHEMA_DDL } from '../database/schema';

/**
 * @class DatabaseService
 * @description Owns all bun:sqlite read/write operations for TSA.
 * Inject Database instance for testability (use :memory: in tests).
 */
export class DatabaseService extends BaseService {
  private readonly db: Database;

  /**
   * @param db A bun:sqlite Database instance
   */
  constructor(db: Database) {
    super('DatabaseService');
    this.db = db;
  }

  /**
   * Run DDL migration to create all tables and indexes. Safe to call multiple times.
   * @throws QueryError if schema initialization fails
   */
  initialize(): void {
    try {
      this.db.exec(SCHEMA_DDL);
      this.logInfo(LogEvents.DB_INITIALIZED);
    } catch (err) {
      throw new QueryError('Failed to initialize schema', { cause: String(err) });
    }
  }

  /**
   * Get current schema version from project_meta.
   * @returns Schema version number, 0 if not set
   */
  getSchemaVersion(): number {
    try {
      const row = this.db.query("SELECT value FROM project_meta WHERE key = 'schema_version'").get() as { value: string } | null;
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Insert symbols in bulk using a transaction with two-pass parent_id resolution.
   * @param symbols Array of TsaSymbol — _parentName triggers second-pass resolution
   * @throws QueryError on insert failure
   */
  insertSymbols(symbols: TsaSymbol[]): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols
        (name, kind, file_path, line, column, end_line, parent_id, signature, modifiers, return_type, params, doc_comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((syms: TsaSymbol[]) => {
      const topLevel = syms.filter(s => !s._parentName);
      for (const s of topLevel) {
        insertStmt.run(s.name, s.kind, s.file_path, s.line, s.column, s.end_line,
          null, s.signature, s.modifiers, s.return_type, s.params, s.doc_comment);
      }
      const children = syms.filter(s => s._parentName);
      for (const s of children) {
        const parent = this.db.query('SELECT id FROM symbols WHERE name = ? AND file_path = ?')
          .get(s._parentName!, s.file_path) as { id: number } | null;
        insertStmt.run(s.name, s.kind, s.file_path, s.line, s.column, s.end_line,
          parent?.id ?? null, s.signature, s.modifiers, s.return_type, s.params, s.doc_comment);
      }
    });

    try {
      tx(symbols);
      this.logDebug(LogEvents.SYMBOLS_INSERTED, { count: symbols.length });
    } catch (err) {
      throw new QueryError('Failed to insert symbols', { cause: String(err) });
    }
  }

  /**
   * Delete all symbols (and cascading references) for a file.
   * @param filePath File path to clear
   * @throws QueryError on failure
   */
  deleteFileSymbols(filePath: string): void {
    try {
      this.db.run('DELETE FROM symbols WHERE file_path = ?', [filePath]);
      this.logDebug(LogEvents.FILE_SYMBOLS_DELETED, { filePath });
    } catch (err) {
      throw new QueryError('Failed to delete file symbols', { cause: String(err), filePath });
    }
  }

  /**
   * Exact-name lookup for find_symbol tool.
   * @param name Symbol name
   * @param kind Optional kind filter
   */
  querySymbolsByName(name: string, kind?: string): SymbolRow[] {
    try {
      if (kind) {
        return this.db.query('SELECT * FROM symbols WHERE name = ? AND kind = ?').all(name, kind) as SymbolRow[];
      }
      return this.db.query('SELECT * FROM symbols WHERE name = ?').all(name) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to query symbols by name', { cause: String(err), name });
    }
  }

  /**
   * LIKE search for search_symbols tool.
   * @param query Partial name to match
   * @param kind Optional kind filter
   * @param limit Maximum results
   */
  searchSymbols(query: string, kind?: string, limit: number = 20): SymbolRow[] {
    try {
      const pattern = `%${query}%`;
      if (kind) {
        return this.db.query('SELECT * FROM symbols WHERE name LIKE ? AND kind = ? LIMIT ?').all(pattern, kind, limit) as SymbolRow[];
      }
      return this.db.query('SELECT * FROM symbols WHERE name LIKE ? LIMIT ?').all(pattern, limit) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to search symbols', { cause: String(err), query });
    }
  }

  /**
   * Get all methods/members of a class by class name.
   * @param className Name of the class
   */
  getMethodsByClassName(className: string): SymbolRow[] {
    try {
      const parent = this.db.query("SELECT id FROM symbols WHERE name = ? AND kind = 'class'")
        .get(className) as { id: number } | null;
      if (!parent) return [];
      return this.db.query('SELECT * FROM symbols WHERE parent_id = ?').all(parent.id) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to get methods', { cause: String(err), className });
    }
  }

  /**
   * Get all symbols in a file, optionally filtered by kind.
   * @param filePath Path to the file
   * @param kind Optional kind filter
   */
  getSymbolsByFile(filePath: string, kind?: string): SymbolRow[] {
    try {
      if (kind) {
        return this.db.query('SELECT * FROM symbols WHERE file_path = ? AND kind = ?').all(filePath, kind) as SymbolRow[];
      }
      return this.db.query('SELECT * FROM symbols WHERE file_path = ?').all(filePath) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to get symbols for file', { cause: String(err), filePath });
    }
  }

  /**
   * Insert call graph edges in bulk.
   * @param refs Array of TsaReference edges
   * @throws QueryError on failure
   */
  insertReferences(refs: TsaReference[]): void {
    if (refs.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO "references" (source_symbol_id, target_symbol_id, ref_kind, source_line, confidence)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((rs: TsaReference[]) => {
      for (const r of rs) {
        stmt.run(r.source_symbol_id, r.target_symbol_id, r.ref_kind, r.source_line, r.confidence);
      }
    });
    try {
      tx(refs);
      this.logDebug(LogEvents.REFS_INSERTED, { count: refs.length });
    } catch (err) {
      throw new QueryError('Failed to insert references', { cause: String(err) });
    }
  }

  /**
   * Get all callers of a symbol.
   * @param targetSymbolId ID of the callee symbol
   */
  getCallers(targetSymbolId: number): ReferenceRow[] {
    try {
      return this.db.query(`
        SELECT r.*, s.name as caller_name, s.file_path as caller_file, s.line as caller_line,
               p.name as caller_class
        FROM "references" r
        JOIN symbols s ON s.id = r.source_symbol_id
        LEFT JOIN symbols p ON p.id = s.parent_id AND p.kind = 'class'
        WHERE r.target_symbol_id = ? AND r.ref_kind = 'calls'
      `).all(targetSymbolId) as ReferenceRow[];
    } catch (err) {
      throw new QueryError('Failed to get callers', { cause: String(err), targetSymbolId });
    }
  }

  /**
   * Get all classes that implement a given interface.
   * @param interfaceSymbolId ID of the interface symbol
   */
  getImplementors(interfaceSymbolId: number): ReferenceRow[] {
    try {
      return this.db.query(`
        SELECT r.*, s.name as class_name, s.file_path
        FROM "references" r
        JOIN symbols s ON s.id = r.source_symbol_id
        WHERE r.target_symbol_id = ? AND r.ref_kind = 'implements'
      `).all(interfaceSymbolId) as ReferenceRow[];
    } catch (err) {
      throw new QueryError('Failed to get implementors', { cause: String(err) });
    }
  }

  /**
   * Get full class hierarchy data.
   * @param classSymbolId ID of the class symbol
   */
  getHierarchyData(classSymbolId: number): { extends: SymbolRow[], implements: SymbolRow[], extended_by: SymbolRow[], implemented_by: SymbolRow[] } {
    try {
      const ext = this.db.query(`SELECT s.* FROM "references" r JOIN symbols s ON s.id = r.target_symbol_id WHERE r.source_symbol_id = ? AND r.ref_kind = 'extends'`).all(classSymbolId) as SymbolRow[];
      const impl = this.db.query(`SELECT s.* FROM "references" r JOIN symbols s ON s.id = r.target_symbol_id WHERE r.source_symbol_id = ? AND r.ref_kind = 'implements'`).all(classSymbolId) as SymbolRow[];
      const extBy = this.db.query(`SELECT s.* FROM "references" r JOIN symbols s ON s.id = r.source_symbol_id WHERE r.target_symbol_id = ? AND r.ref_kind = 'extends'`).all(classSymbolId) as SymbolRow[];
      const implBy = this.db.query(`SELECT s.* FROM "references" r JOIN symbols s ON s.id = r.source_symbol_id WHERE r.target_symbol_id = ? AND r.ref_kind = 'implements'`).all(classSymbolId) as SymbolRow[];
      return { extends: ext, implements: impl, extended_by: extBy, implemented_by: implBy };
    } catch (err) {
      throw new QueryError('Failed to get hierarchy data', { cause: String(err) });
    }
  }

  /**
   * Get files this file imports from and files that import this file.
   * @param filePath The file to get relationships for
   */
  getRelatedFiles(filePath: string): { imports_from: string[], imported_by: string[] } {
    try {
      const ids = (this.db.query('SELECT id FROM symbols WHERE file_path = ?').all(filePath) as { id: number }[]).map(r => r.id);
      if (ids.length === 0) return { imports_from: [], imported_by: [] };
      const ph = ids.map(() => '?').join(',');
      const importsFrom = (this.db.query(`SELECT DISTINCT s.file_path FROM "references" r JOIN symbols s ON s.id = r.target_symbol_id WHERE r.source_symbol_id IN (${ph}) AND r.ref_kind = 'imports' AND s.file_path != ?`).all(...ids, filePath) as { file_path: string }[]).map(r => r.file_path);
      const importedBy = (this.db.query(`SELECT DISTINCT s.file_path FROM "references" r JOIN symbols s ON s.id = r.source_symbol_id WHERE r.target_symbol_id IN (${ph}) AND r.ref_kind = 'imports' AND s.file_path != ?`).all(...ids, filePath) as { file_path: string }[]).map(r => r.file_path);
      return { imports_from: importsFrom, imported_by: importedBy };
    } catch (err) {
      throw new QueryError('Failed to get related files', { cause: String(err), filePath });
    }
  }

  /**
   * Upsert a file record for incremental indexing.
   * @param record File record to store
   */
  upsertFile(record: FileRecord): void {
    try {
      this.db.run(
        'INSERT OR REPLACE INTO files (path, last_modified, content_hash, symbol_count, index_time_ms) VALUES (?, ?, ?, ?, ?)',
        [record.path, record.last_modified, record.content_hash, record.symbol_count, record.index_time_ms]
      );
    } catch (err) {
      throw new QueryError('Failed to upsert file record', { cause: String(err) });
    }
  }

  /**
   * Get a file record by path for hash-based change detection.
   * @param filePath Path to look up
   * @returns FileRow or null if not indexed
   */
  getFileRecord(filePath: string): FileRow | null {
    try {
      return this.db.query('SELECT * FROM files WHERE path = ?').get(filePath) as FileRow | null;
    } catch (err) {
      throw new QueryError('Failed to get file record', { cause: String(err), filePath });
    }
  }

  /**
   * Get all tracked file paths.
   * @returns Array of file paths
   */
  getAllFilePaths(): string[] {
    try {
      return (this.db.query('SELECT path FROM files').all() as { path: string }[]).map(r => r.path);
    } catch (err) {
      throw new QueryError('Failed to get all file paths', { cause: String(err) });
    }
  }
}
