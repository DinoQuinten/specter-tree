import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ParserService } from './ParserService';

/** @interface FlushResult — returned by flush_file tool */
export interface FlushResult {
  success: boolean;
  symbols_indexed: number;
  time_ms: number;
}

/**
 * @class IndexerService
 * @description Orchestrates file watching, debounced re-indexing, and full project scans.
 * scanProject uses a two-pass strategy: index all symbols first, then resolve all references.
 * This ensures cross-file call graph edges resolve correctly regardless of file order.
 * Known limitation: incremental re-index (single file) only rebuilds that file's outgoing refs.
 */
export class IndexerService extends BaseService {
  private readonly db: DatabaseService;
  private readonly parser: ParserService;
  private readonly pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;

  constructor(db: DatabaseService, parser: ParserService) {
    super('IndexerService');
    this.db = db;
    this.parser = parser;
  }

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
   * Re-index a single file: symbols + outgoing references.
   * Outgoing refs from this file are rebuilt. Refs from other files pointing here
   * remain valid (IDs are stable after re-index). Rebuilt on next scanProject if stale.
   */
  async reindexFile(filePath: string): Promise<void> {
    const start = Date.now();
    await this.indexSymbols(filePath);
    const knownNames = this.db.getAllSymbolNames();
    this.indexRefs(filePath, knownNames);
    this.logInfo(LogEvents.INDEXER_FILE_CHANGED, { filePath, ms: Date.now() - start });
  }

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
   * Two-pass full project scan.
   * Pass 1: index all symbols (skip unchanged files by hash, but still load into ts-morph).
   * Pass 2: extract and resolve references for ALL files after all symbols are indexed.
   */
  async scanProject(projectRoot: string): Promise<void> {
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
    const knownNames = this.db.getAllSymbolNames();
    for (const filePath of files) {
      try {
        this.indexRefs(filePath, knownNames);
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }

    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot, indexed, total: files.length });
  }

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
      this.logInfo(LogEvents.INDEXER_FILE_DELETED, { filePath: abs });
    });
    return watcher;
  }

  /** Index symbols only for a file — used in scanProject pass 1 and reindexFile. */
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

  /** Extract and insert outgoing refs for a file — used in reindexFile and scanProject pass 2. */
  private indexRefs(filePath: string, knownNames: Set<string>): void {
    this.db.deleteFileReferences(filePath);
    const namedRefs = this.parser.extractReferences(filePath, knownNames);
    this.db.resolveAndInsertNamedRefs(namedRefs);
  }

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
