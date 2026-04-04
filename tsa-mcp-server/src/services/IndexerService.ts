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
 * Delegates AST work to ParserService and storage to DatabaseService.
 */
export class IndexerService extends BaseService {
  private readonly db: DatabaseService;
  private readonly parser: ParserService;
  private readonly pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;

  /**
   * @param db DatabaseService instance
   * @param parser ParserService instance
   */
  constructor(db: DatabaseService, parser: ParserService) {
    super('IndexerService');
    this.db = db;
    this.parser = parser;
  }

  /**
   * Schedule a debounced re-index for a file.
   * Editors fire 2-3 chokidar events per save — debounce ensures single re-index.
   * @param filePath File that changed
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
   * Immediately re-index a file, bypassing debounce.
   * Called directly — guarantees index is current for the next query.
   * @param filePath Absolute path to the file
   */
  async reindexFile(filePath: string): Promise<void> {
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

    this.logInfo(LogEvents.INDEXER_FILE_CHANGED, { filePath, symbols: symbols.length, ms: Date.now() - start });
  }

  /**
   * Force synchronous re-index, bypassing debounce. Used by flush_file MCP tool.
   * Cancels any pending debounce for this file first.
   * @param filePath File to re-index
   * @returns FlushResult with symbol count and timing
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
   * Scan all .ts/.tsx files in projectRoot — skip unchanged files via hash check.
   * @param projectRoot Absolute project root path
   */
  async scanProject(projectRoot: string): Promise<void> {
    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot });
    const files = this.collectTypeScriptFiles(projectRoot);
    let indexed = 0;
    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        const existing = this.db.getFileRecord(filePath);
        if (existing?.content_hash === hash) {
          this.logDebug(LogEvents.INDEXER_FILE_SKIPPED, { filePath });
          continue;
        }
        await this.reindexFile(filePath);
        indexed++;
      } catch (err) {
        this.logError(LogEvents.INDEXER_FILE_CHANGED, err, { filePath });
      }
    }
    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot, indexed, total: files.length });
  }

  /**
   * Start chokidar file watcher. Returns watcher for cleanup on shutdown.
   * @param projectRoot Absolute project root path
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
      this.logInfo(LogEvents.INDEXER_FILE_DELETED, { filePath: abs });
    });
    return watcher;
  }

  private collectTypeScriptFiles(projectRoot: string): string[] {
    const files: string[] = [];
    const SKIP = new Set(['node_modules', 'dist', '.tsa', '.git']);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
