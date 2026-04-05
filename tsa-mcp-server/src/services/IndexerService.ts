/**
 * @file IndexerService.ts
 * @description Orchestrates file watching, debounced re-indexing, and full two-pass project scans.
 * Pass 1 indexes all symbols; pass 2 resolves all cross-file references once every symbol is present.
 * @module services
 */
import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ParserService } from './ParserService';

/**
 * @description Opaque proof-of-scan token returned by scanProject.
 * Services that require a populated database accept ScannedDb instead of DatabaseService
 * directly, so the compiler rejects construction before the scan completes.
 */
export interface ScannedDb {
  /** @description The populated DatabaseService instance. */
  readonly db: import('./DatabaseService').DatabaseService;
}

/**
 * @description Result returned by the flush_file tool after forcing an immediate re-index.
 */
export interface FlushResult {
  /** @description Whether the re-index completed without errors. */
  success: boolean;
  /** @description Number of symbols found in the file after re-indexing. */
  symbols_indexed: number;
  /** @description Wall-clock time taken for the operation in milliseconds. */
  time_ms: number;
}

/**
 * @class IndexerService
 * @description Orchestrates file watching, debounced re-indexing, and full project scans.
 * scanProject uses a two-pass strategy: index all symbols first, then resolve all references,
 * ensuring cross-file call graph edges resolve correctly regardless of file discovery order.
 * Known limitation: incremental re-index (single file) only rebuilds that file's outgoing refs.
 * @example
 * const indexer = new IndexerService(dbService, parserService);
 * await indexer.scanProject('/repo');
 */
export class IndexerService extends BaseService {
  private readonly db: DatabaseService;
  private readonly parser: ParserService;
  private readonly pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;

  /**
   * @description Creates an IndexerService with its database and parser dependencies.
   * @param db - DatabaseService instance for all symbol and reference persistence.
   * @param parser - ParserService instance used to extract symbols and references from files.
   */
  constructor(db: DatabaseService, parser: ParserService) {
    super('IndexerService');
    this.db = db;
    this.parser = parser;
  }

  /**
   * @description Schedules a debounced re-index for a file changed on disk.
   * Resets the debounce timer if one is already pending for the same path.
   * @param filePath - Absolute path of the file to re-index.
   */
  scheduleReindex(filePath: string): void {
    const existing = this.pendingDebounce.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingDebounce.delete(filePath);
      this.reindexFile(filePath).catch(err =>
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath })
      );
    }, this.DEBOUNCE_MS);
    this.pendingDebounce.set(filePath, timer);
  }

  /**
   * @description Re-indexes a single file's symbols, then rebuilds all project references.
   * All project files' outgoing refs are re-resolved so inbound refs to this file stay
   * accurate even when callers or implementors live in other files.
   * @param filePath - Absolute path of the file to re-index.
   * @returns Promise that resolves when re-indexing is complete.
   */
  async reindexFile(filePath: string): Promise<void> {
    const start = Date.now();
    await this.indexSymbols(filePath);
    this.rebuildProjectReferences();
    this.logInfo(LogEvents.INDEXER_FILE_CHANGED, { filePath, ms: Date.now() - start });
  }

  /**
   * @description Immediately flushes any pending debounce timer for a file and re-indexes it.
   * Used by the flush_file tool to force an up-to-date index without waiting for the debounce.
   * @param filePath - Absolute path of the file to flush and re-index.
   * @returns FlushResult with success flag, symbol count, and elapsed time.
   */
  async flushFile(filePath: string): Promise<FlushResult> {
    const pending = this.pendingDebounce.get(filePath);
    if (pending) {
      clearTimeout(pending);
      this.pendingDebounce.delete(filePath);
    }
    const start = Date.now();
    try {
      await this.reindexFile(filePath);
      const symbols = this.db.getSymbolsByFile(filePath);
      this.logInfo(LogEvents.INDEXER_FLUSH, { filePath, symbols: symbols.length });
      return { success: true, symbols_indexed: symbols.length, time_ms: Date.now() - start };
    } catch (err) {
      this.logError(LogEvents.INDEXER_FLUSH, err, { filePath });
      return { success: false, symbols_indexed: 0, time_ms: Date.now() - start };
    }
  }

  /**
   * @description Runs a two-pass full project scan.
   * Pass 1 indexes all symbols, skipping unchanged files by content hash but still loading
   * them into ts-morph for pass 2. Pass 2 extracts and resolves references for all files
   * after every symbol is present in the database.
   * @param projectRoot - Absolute path to the project root to scan.
   * @returns Promise that resolves when both passes are complete.
   */
  async scanProject(projectRoot: string): Promise<ScannedDb> {
    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot });
    const files = this.collectTypeScriptFiles(projectRoot);

    // Pass 1: symbols
    let indexed = 0;
    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        const existing = this.db.getFileRecord(filePath);
        if (existing?.content_hash === hash) {
          this.logDebug(LogEvents.INDEXER_FILE_SKIPPED, { filePath });
          // Still load into ts-morph so extractReferences can use it in pass 2
          this.parser.parseFile(filePath);
          continue;
        }
        await this.indexSymbols(filePath);
        indexed++;
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }

    // Pass 2: references (all files — cross-file resolution requires all symbols present)
    this.rebuildProjectReferences(files);

    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot, indexed, total: files.length });

    // Return the populated db as a ScannedDb token — callers that receive this have
    // compile-time proof the scan completed before constructing dependent services.
    return { db: this.db };
  }

  /**
   * @description Starts a chokidar file watcher on all .ts and .tsx files in the project root.
   * Add and change events schedule a debounced re-index; unlink events delete the file's symbols.
   * @param projectRoot - Absolute path to the project root to watch.
   * @returns The chokidar FSWatcher instance (caller is responsible for closing it on shutdown).
   */
  startWatcher(projectRoot: string): ReturnType<typeof watch> {
    const watcher = watch('**/*.{ts,tsx}', {
      cwd: projectRoot,
      ignored: /(node_modules|dist|\.tsa|\.git)/,
      persistent: true,
      ignoreInitial: true
    });
    watcher.on('add', (rel) => this.scheduleReindex(join(projectRoot, rel)));
    watcher.on('change', (rel) => this.scheduleReindex(join(projectRoot, rel)));
    watcher.on('unlink', (rel) => {
      const abs = join(projectRoot, rel);
      this.db.deleteFileSymbols(abs);
      this.db.deleteFileImports(abs);
      this.logInfo(LogEvents.INDEXER_FILE_DELETED, { filePath: abs });
    });
    return watcher;
  }

  /**
   * @description Indexes symbols for a single file: hashes the content, clears stale rows,
   * parses symbols, inserts them into the database, and upserts the file record.
   * Used during scanProject pass 1 and by reindexFile.
   * @param filePath - Absolute path of the file to index.
   */
  private async indexSymbols(filePath: string): Promise<void> {
    const start = Date.now();
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const stat = statSync(filePath);
    this.db.deleteFileSymbols(filePath);
    const symbols = this.parser.parseFile(filePath);
    this.db.insertSymbols(symbols);
    this.db.upsertFile({
      path: filePath, last_modified: stat.mtimeMs,
      content_hash: hash, symbol_count: symbols.length,
      index_time_ms: Date.now() - start
    });
  }

  /**
   * @description Extracts and inserts outgoing references for a single file.
   * Clears existing reference rows for the file before inserting the freshly extracted set.
   * Used in reindexFile and scanProject pass 2.
   * @param filePath - Absolute path of the file to process.
   * @param knownNames - Set of all project symbol names used to filter call edges.
   */
  private indexRefs(filePath: string, knownNames: Set<string>): void {
    this.db.deleteFileReferences(filePath);
    const namedRefs = this.parser.extractReferences(filePath, knownNames);
    this.db.resolveAndInsertNamedRefs(namedRefs);
    this.db.replaceFileImports(filePath, this.parser.extractFileImports(filePath));
  }

  /**
   * @description Rebuilds reference edges for all specified files using the current symbol index.
   * Defaults to every tracked file when no list is provided (used during single-file re-index).
   * @param files - Optional list of absolute file paths to rebuild references for.
   */
  private rebuildProjectReferences(files: string[] = this.db.getAllFilePaths()): void {
    const knownNames = this.db.getAllSymbolNames();
    for (const filePath of files) {
      try {
        this.indexRefs(filePath, knownNames);
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }
  }

  /**
   * @description Recursively collects all .ts and .tsx file paths under the project root,
   * skipping node_modules, dist, .tsa, and .git directories.
   * @param projectRoot - Absolute path to the directory to walk.
   * @returns Flat array of absolute file paths for all TypeScript source files found.
   */
  private collectTypeScriptFiles(projectRoot: string): string[] {
    const files: string[] = [];
    const SKIP = new Set(['node_modules', 'dist', '.tsa', '.git']);
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { dir });
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP.has(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(join(dir, entry.name));
        }
      }
    };
    walk(projectRoot);
    return files;
  }
}
