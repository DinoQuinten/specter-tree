/**
 * @file ProjectRuntime.ts
 * @description Manages the currently bound project root and the root-scoped service graph.
 * @module runtime
 */
import type { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { getDatabase } from '../database/client';
import { DatabaseService } from '../services/DatabaseService';
import { ParserService } from '../services/ParserService';
import { IndexerService } from '../services/IndexerService';
import { SymbolService } from '../services/SymbolService';
import { ReferenceService } from '../services/ReferenceService';
import { FrameworkService } from '../services/FrameworkService';
import { ConfigService } from '../services/ConfigService';
import { InsightService } from '../services/InsightService';

export interface ProjectServices {
  db: DatabaseService;
  indexer: IndexerService;
  symbols: SymbolService;
  references: ReferenceService;
  framework: FrameworkService;
  config: ConfigService;
  insight: InsightService;
}

interface RuntimeState {
  projectRoot: string;
  dbPath: string;
  rawDb: Database;
  watcher: ReturnType<typeof import('chokidar').watch>;
  services: ProjectServices;
}

export interface SetProjectRootResult {
  success: boolean;
  project_root: string;
  db_path: string;
  indexed: number;
  time_ms: number;
  reindexed: boolean;
}

interface ProjectRuntimeOptions {
  initialProjectRoot: string;
  dbPathOverride?: string;
}

/**
 * @description Owns the mutable project binding for a TSA stdio server process.
 */
export class ProjectRuntime {
  private readonly initialProjectRoot: string;
  private readonly dbPathOverride?: string;
  private state: RuntimeState | null = null;

  constructor(options: ProjectRuntimeOptions) {
    this.initialProjectRoot = options.initialProjectRoot;
    this.dbPathOverride = options.dbPathOverride;
  }

  async initialize(): Promise<SetProjectRootResult> {
    return this.setProjectRoot(this.initialProjectRoot);
  }

  getProjectRoot(): string {
    if (!this.state) throw new Error('ProjectRuntime is not initialized');
    return this.state.projectRoot;
  }

  getDbPath(): string {
    if (!this.state) throw new Error('ProjectRuntime is not initialized');
    return this.state.dbPath;
  }

  getServices(): ProjectServices {
    if (!this.state) throw new Error('ProjectRuntime is not initialized');
    return this.state.services;
  }

  async setProjectRoot(projectRoot: string): Promise<SetProjectRootResult> {
    const start = Date.now();
    if (this.state && this.state.projectRoot === projectRoot) {
      return {
        success: true,
        project_root: projectRoot,
        db_path: this.state.dbPath,
        indexed: this.state.services.db.getAllFilePaths().length,
        time_ms: Date.now() - start,
        reindexed: false
      };
    }

    // dbPathOverride is test-only — all roots share the same file when set.
    // In production each root gets its own .tsa/index.db.
    const nextDbPath = this.dbPathOverride ?? join(projectRoot, '.tsa', 'index.db');
    const rawDb = getDatabase(nextDbPath);
    const db = new DatabaseService(rawDb);
    db.initialize();
    db.resetProjectData();

    const parser = new ParserService(undefined, projectRoot);
    const indexer = new IndexerService(db, parser);
    // Scan must complete before any service is constructed — services receive a populated db.
    // Old state remains live for in-flight calls during this await; state swap is atomic after.
    // scanned.db is the compile-time proof the scan completed — services that require
    // a populated database accept ScannedDb, so the compiler rejects early construction.
    const scanned = await indexer.scanProject(projectRoot);

    const framework = new FrameworkService(projectRoot);
    const config = new ConfigService(projectRoot);
    const symbols = new SymbolService(scanned.db);
    const references = new ReferenceService(scanned.db);
    const insight = new InsightService(projectRoot, scanned.db, framework);
    const watcher = indexer.startWatcher(projectRoot);

    const previous = this.state;
    this.state = {
      projectRoot,
      dbPath: nextDbPath,
      rawDb,
      watcher,
      services: { db, indexer, symbols, references, framework, config, insight }
    };

    await this.closeState(previous);

    return {
      success: true,
      project_root: projectRoot,
      db_path: nextDbPath,
      indexed: db.getAllFilePaths().length,
      time_ms: Date.now() - start,
      reindexed: true
    };
  }

  async shutdown(): Promise<void> {
    if (!this.state) return;
    await this.closeState(this.state);
    this.state = null;
  }

  private async closeState(state: RuntimeState | null): Promise<void> {
    if (!state) return;
    await state.watcher.close();
    state.rawDb.close();
    // Windows can hold directory handles briefly after watcher shutdown.
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
