/**
 * @file DatabaseService.ts
 * @description All bun:sqlite read/write operations for the TSA symbol and reference graph.
 * Inject a Database instance for testability — use an in-memory database in tests.
 * @module services
 */
import type { Database } from 'bun:sqlite';
import { BaseService } from './BaseService';
import { QueryError } from '../errors/QueryError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, TsaReference, FileRecord, NamedRef } from '../types/common';
import type { SymbolRow, ReferenceRow, FileRow } from '../database/types';
import { SCHEMA_DDL } from '../database/schema';

/**
 * @class DatabaseService
 * @description Owns all bun:sqlite read/write operations for TSA.
 * Inject a Database instance for testability (use :memory: in tests).
 * @example
 * const db = new Database(':memory:');
 * const dbService = new DatabaseService(db);
 * dbService.initialize();
 */
export class DatabaseService extends BaseService {
  private readonly db: Database;
  private initialized = false;

  /**
   * @description Creates a new DatabaseService wrapping the provided bun:sqlite instance.
   * Call initialize() after construction to apply the schema DDL.
   * @param db - A bun:sqlite Database instance (file-backed or :memory:).
   */
  constructor(db: Database) {
    super('DatabaseService');
    this.db = db;
  }

  /**
   * @description Runs the DDL migration to create all tables and indexes.
   * Safe to call multiple times — subsequent calls are no-ops.
   * @throws {QueryError} - When schema initialization fails.
   */
  initialize(): void {
    if (this.initialized) return;
    try {
      this.db.exec(SCHEMA_DDL);
      this.initialized = true;
      this.logInfo(LogEvents.DB_INITIALIZED);
    } catch (err) {
      throw new QueryError('Failed to initialize schema', { cause: String(err) });
    }
  }

  /**
   * @description Reads the current schema version from the project_meta table.
   * @returns Schema version number, or 0 when the key has not been set.
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
   * @description Inserts symbols in bulk using a transaction with two-pass parent_id resolution.
   * Top-level symbols are written first; children with a _parentName are inserted in a second
   * pass so parent IDs are available for the foreign-key link.
   * @param symbols - Array of TsaSymbol to persist. Symbols with _parentName trigger second-pass resolution.
   * @throws {QueryError} - When the insert transaction fails.
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
   * @description Deletes all symbols (and their cascading references) for a file.
   * Called before re-indexing a changed file to avoid stale rows.
   * @param filePath - Absolute path of the file whose symbols should be removed.
   * @throws {QueryError} - When the delete statement fails.
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
   * @description Exact-name lookup for the find_symbol tool.
   * @param name - Symbol name to match exactly.
   * @param kind - Optional kind filter (e.g. 'class', 'function').
   * @returns All matching symbol rows.
   * @throws {QueryError} - When the query fails.
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
   * @description Looks up symbols by name scoped to a specific parent class.
   * Useful for disambiguating methods that share a name across multiple classes.
   * @param name - Symbol name to match exactly.
   * @param parentName - Name of the enclosing class.
   * @param kind - Optional kind filter.
   * @returns Matching symbol rows that are direct children of the named class.
   * @throws {QueryError} - When the query fails.
   */
  querySymbolsByNameAndParent(name: string, parentName: string, kind?: string): SymbolRow[] {
    try {
      if (kind) {
        return this.db.query(`
          SELECT s.*
          FROM symbols s
          JOIN symbols p ON p.id = s.parent_id
          WHERE s.name = ? AND s.kind = ? AND p.name = ? AND p.kind = 'class'
        `).all(name, kind, parentName) as SymbolRow[];
      }

      return this.db.query(`
        SELECT s.*
        FROM symbols s
        JOIN symbols p ON p.id = s.parent_id
        WHERE s.name = ? AND p.name = ? AND p.kind = 'class'
      `).all(name, parentName) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to query symbols by parent', { cause: String(err), name, parentName });
    }
  }

  /**
   * @description LIKE search for the search_symbols tool.
   * @param query - Partial name to match (wrapped in % wildcards).
   * @param kind - Optional kind filter.
   * @param limit - Maximum number of results to return. Defaults to 20.
   * @returns Symbol rows whose names contain the query substring.
   * @throws {QueryError} - When the query fails.
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
   * @description Fetches all methods and members of a class by class name.
   * @param className - Name of the class whose members to retrieve.
   * @returns Symbol rows that are direct children of the named class.
   * @throws {QueryError} - When the query fails.
   */
  getMethodsByClassName(className: string): SymbolRow[] {
    try {
      return this.db.query(`
        SELECT child.*
        FROM symbols child
        JOIN symbols parent ON parent.id = child.parent_id
        WHERE parent.name = ? AND parent.kind = 'class'
      `).all(className) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to get methods', { cause: String(err), className });
    }
  }

  /**
   * @description Fetches all symbols in a file, optionally filtered by kind.
   * @param filePath - Absolute path to the source file.
   * @param kind - Optional kind filter (e.g. 'class', 'interface').
   * @returns All symbol rows belonging to the file.
   * @throws {QueryError} - When the query fails.
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
   * @description Inserts call graph edges in bulk inside a single transaction.
   * @param refs - Array of TsaReference edges to persist.
   * @throws {QueryError} - When the insert transaction fails.
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
   * @description Fetches all callers of a symbol by joining the references table with symbols.
   * @param targetSymbolId - Primary key of the callee symbol.
   * @returns Reference rows enriched with caller name, file, line, and class.
   * @throws {QueryError} - When the query fails.
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
   * @description Fetches all classes that implement a given interface.
   * @param interfaceSymbolId - Primary key of the interface symbol.
   * @returns Reference rows enriched with class name and file path.
   * @throws {QueryError} - When the query fails.
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
   * @description Fetches the full class hierarchy for a symbol: what it extends, what it
   * implements, which classes extend it, and which classes implement it.
   * @param classSymbolId - Primary key of the class symbol.
   * @returns Object containing four symbol-row arrays for each hierarchy direction.
   * @throws {QueryError} - When any of the four queries fail.
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
   * @description Retrieves outgoing references for a source symbol, optionally filtered by kind.
   * @param sourceSymbolId - Source symbol identifier.
   * @param refKind - Optional edge kind filter.
   * @returns Raw reference rows for outbound edges.
   */
  getOutgoingReferences(sourceSymbolId: number, refKind?: string): ReferenceRow[] {
    try {
      if (refKind) {
        return this.db.query('SELECT * FROM "references" WHERE source_symbol_id = ? AND ref_kind = ?')
          .all(sourceSymbolId, refKind) as ReferenceRow[];
      }
      return this.db.query('SELECT * FROM "references" WHERE source_symbol_id = ?')
        .all(sourceSymbolId) as ReferenceRow[];
    } catch (err) {
      throw new QueryError('Failed to get outgoing references', { cause: String(err), sourceSymbolId, refKind });
    }
  }

  /**
   * @description Retrieves one symbol row by its primary key.
   * @param id - Symbol identifier.
   * @returns Matching symbol row, or null when absent.
   */
  getSymbolById(id: number): SymbolRow | null {
    try {
      return this.db.query('SELECT * FROM symbols WHERE id = ?').get(id) as SymbolRow | null;
    } catch (err) {
      throw new QueryError('Failed to get symbol by id', { cause: String(err), id });
    }
  }

  /**
   * @description Returns the import relationships for a file: files it imports from and
   * files that import it.
   * @param filePath - Absolute path of the file to query.
   * @returns Object with imports_from and imported_by file path arrays.
   * @throws {QueryError} - When the query fails.
   */
  getRelatedFiles(filePath: string): { imports_from: string[], imported_by: string[] } {
    try {
      const importsFrom = (this.db.query('SELECT target_file FROM file_imports WHERE source_file = ?').all(filePath) as { target_file: string }[])
        .map(r => r.target_file);
      const importedBy = (this.db.query('SELECT source_file FROM file_imports WHERE target_file = ?').all(filePath) as { source_file: string }[])
        .map(r => r.source_file);
      return { imports_from: importsFrom, imported_by: importedBy };
    } catch (err) {
      throw new QueryError('Failed to get related files', { cause: String(err), filePath });
    }
  }

  /**
   * @description Upserts a file record used for hash-based incremental indexing.
   * @param record - File record containing path, hash, modification time, and index stats.
   * @throws {QueryError} - When the upsert fails.
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
   * @description Fetches a file record by path for hash-based change detection.
   * @param filePath - Absolute path to look up.
   * @returns The FileRow, or null when the file has not been indexed yet.
   * @throws {QueryError} - When the query fails.
   */
  getFileRecord(filePath: string): FileRow | null {
    try {
      return this.db.query('SELECT * FROM files WHERE path = ?').get(filePath) as FileRow | null;
    } catch (err) {
      throw new QueryError('Failed to get file record', { cause: String(err), filePath });
    }
  }

  /**
   * @description Fetches all tracked file paths from the files table.
   * @returns Array of absolute file paths that have been indexed.
   * @throws {QueryError} - When the query fails.
   */
  getAllFilePaths(): string[] {
    try {
      return (this.db.query('SELECT path FROM files').all() as { path: string }[]).map(r => r.path);
    } catch (err) {
      throw new QueryError('Failed to get all file paths', { cause: String(err) });
    }
  }

  /**
   * @description Fetches all distinct symbol names in the index.
   * Used to filter call graph extraction to project-defined symbols only.
   * @returns Set of every unique symbol name currently indexed.
   * @throws {QueryError} - When the query fails.
   */
  getAllSymbolNames(): Set<string> {
    try {
      const rows = this.db.query('SELECT DISTINCT name FROM symbols').all() as { name: string }[];
      return new Set(rows.map(r => r.name));
    } catch (err) {
      throw new QueryError('Failed to get all symbol names', { cause: String(err) });
    }
  }

  /**
   * @description Deletes all references whose source symbol belongs to the given file.
   * Called when refreshing reference edges for a file without re-indexing its symbols.
   * @param filePath - Absolute path of the file whose outgoing references should be cleared.
   * @throws {QueryError} - When the delete statement fails.
   */
  deleteFileReferences(filePath: string): void {
    try {
      this.db.run(`
        DELETE FROM "references" WHERE source_symbol_id IN (
          SELECT id FROM symbols WHERE file_path = ?
        )
      `, [filePath]);
    } catch (err) {
      throw new QueryError('Failed to delete file references', { cause: String(err), filePath });
    }
  }

  /**
   * @description Replaces the full import-edge set for a file atomically.
   * Deletes existing entries and inserts the new resolved target paths in one transaction.
   * @param filePath - Absolute path of the source file.
   * @param imports - Resolved absolute paths of all files this file imports.
   * @throws {QueryError} - When the replacement transaction fails.
   */
  replaceFileImports(filePath: string, imports: string[]): void {
    try {
      this.db.run('DELETE FROM file_imports WHERE source_file = ?', [filePath]);
      if (imports.length === 0) return;

      const insert = this.db.prepare('INSERT OR IGNORE INTO file_imports (source_file, target_file) VALUES (?, ?)');
      const tx = this.db.transaction((targets: string[]) => {
        for (const target of targets) insert.run(filePath, target);
      });
      tx(imports);
    } catch (err) {
      throw new QueryError('Failed to replace file imports', { cause: String(err), filePath });
    }
  }

  /**
   * @description Deletes all file_imports rows where the given file is either the source or the target.
   * Called when a file is removed from the project to keep the import graph consistent.
   * @param filePath - Absolute path of the file to remove from both sides of the import graph.
   * @throws {QueryError} - When the delete statement fails.
   */
  deleteFileImports(filePath: string): void {
    try {
      this.db.run('DELETE FROM file_imports WHERE source_file = ? OR target_file = ?', [filePath, filePath]);
    } catch (err) {
      throw new QueryError('Failed to delete file imports', { cause: String(err), filePath });
    }
  }

  /**
   * @description Resolves NamedRef[] to symbol IDs and inserts them into the references table.
   * sourceName='<file>' resolves to any symbol in the source file (for import edges).
   * When targetFile is present the target is resolved by (name + file_path); otherwise by name only.
   * Skips any ref where source or target cannot be resolved.
   * @param refs - Named reference edges produced by ParserService.extractReferences.
   * @throws {QueryError} - When the resolution transaction fails.
   */
  resolveAndInsertNamedRefs(refs: NamedRef[]): void {
    if (refs.length === 0) return;
    const tx = this.db.transaction((namedRefs: NamedRef[]) => {
      const insert          = this.db.prepare(`INSERT OR IGNORE INTO "references" (source_symbol_id, target_symbol_id, ref_kind, source_line, confidence) VALUES (?, ?, ?, ?, ?)`);
      const insertFileImport = this.db.prepare('INSERT OR IGNORE INTO file_imports (source_file, target_file) VALUES (?, ?)');
      const srcByFile       = this.db.prepare('SELECT id FROM symbols WHERE file_path = ? LIMIT 1');
      const srcByName       = this.db.prepare('SELECT id FROM symbols WHERE name = ? AND file_path = ?');
      const srcByNameParent = this.db.prepare(`
        SELECT s.id
        FROM symbols s
        JOIN symbols p ON p.id = s.parent_id
        WHERE s.name = ? AND s.file_path = ? AND p.name = ? AND p.kind = 'class'
      `);
      const tgtByBothAll    = this.db.prepare('SELECT id FROM symbols WHERE name = ? AND file_path = ?');
      const tgtByParent     = this.db.prepare(`
        SELECT s.id
        FROM symbols s
        JOIN symbols p ON p.id = s.parent_id
        WHERE s.name = ? AND s.file_path = ? AND p.name = ? AND p.kind = 'class'
      `);
      const tgtByNameAll    = this.db.prepare('SELECT id FROM symbols WHERE name = ?');
      let inserted = 0;
      for (const ref of namedRefs) {
        const source = (ref.sourceName === '<file>'
          ? srcByFile.get(ref.sourceFile)
          : ref.sourceParentName
            ? srcByNameParent.get(ref.sourceName, ref.sourceFile, ref.sourceParentName)
            : srcByName.get(ref.sourceName, ref.sourceFile)) as { id: number } | null;
        if (!source) continue;

        let target: { id: number } | null = null;
        if (ref.targetFile && ref.targetParentName) {
          target = tgtByParent.get(ref.targetName, ref.targetFile, ref.targetParentName) as { id: number } | null;
        } else if (ref.targetFile) {
          const candidates = tgtByBothAll.all(ref.targetName, ref.targetFile) as { id: number }[];
          target = candidates.length === 1 ? candidates[0]! : null;
        } else {
          const candidates = tgtByNameAll.all(ref.targetName) as { id: number }[];
          target = candidates.length === 1 ? candidates[0]! : null;
        }
        if (!target) continue;
        insert.run(source.id, target.id, ref.ref_kind, ref.source_line, ref.confidence);
        if (ref.ref_kind === 'imports' && ref.targetFile) {
          insertFileImport.run(ref.sourceFile, ref.targetFile);
        }
        inserted++;
      }
      return inserted;
    });
    try {
      const inserted = tx(refs) as number;
      this.logDebug(LogEvents.REFS_INSERTED, { attempted: refs.length, inserted });
    } catch (err) {
      throw new QueryError('Failed to resolve and insert named refs', { cause: String(err) });
    }
  }
}
