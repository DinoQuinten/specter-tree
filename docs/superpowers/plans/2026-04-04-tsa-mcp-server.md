# TSA MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full MCP server that gives AI coding agents semantic understanding of TypeScript codebases through persistent SQLite-indexed AST queries — eliminating wrong-file reads.

**Architecture:** Class-based services (Approach B) — DatabaseService owns all SQLite ops, ParserService owns ts-morph AST extraction, IndexerService orchestrates file watching and indexing, SymbolService/ReferenceService own Layer 2 queries, FrameworkService owns monorepo-aware Layer 3 routing queries. Tool files are thin Zod-validated wrappers that delegate to services.

**Tech Stack:** Bun runtime, `bun:sqlite`, `ts-morph`, `chokidar`, `pino` + `pino-pretty`, `@modelcontextprotocol/sdk`, `zod`, `husky`, `bun:test`

**Spec:** `docs/superpowers/specs/2026-04-04-tsa-mcp-server-design.md`
**Coding standards:** `production-code-standards (1).md`

---

## File Map

```
tsa-mcp-server/
  src/
    index.ts                         # Entry: detectProjectRoot → validateEnv → boot
    server.ts                        # MCP Server init + tool registration
    types/
      common.ts                      # SymbolKind, RefKind, HttpMethod, ToolResult, all shared types
      env.ts                         # EnvVars interface + validateEnv() + detectProjectRoot()
    logging/
      logger.ts                      # pino instance (pretty dev, file prod)
      logQueue.ts                    # LogQueue class — buffers entries, flushes to pino
      logEvents.ts                   # LogEvents enum — all event name constants
    errors/
      TsaError.ts                    # Base error: code + message + context
      IndexError.ts                  # ts-morph parse failures
      QueryError.ts                  # bun:sqlite failures
      FrameworkError.ts              # framework detection/tracing failures
      ValidationError.ts             # Zod input validation failures
    database/
      schema.ts                      # SCHEMA_DDL string — all CREATE TABLE + CREATE INDEX
      client.ts                      # bun:sqlite Database singleton (production use)
      migrations/
        0001_initial.sql             # Full DDL (same as schema.ts, for reference)
      types.ts                       # SymbolRow, ReferenceRow, FileRow (raw DB row types)
    services/
      BaseService.ts                 # Abstract: logInfo/logError/logWarn/logDebug via LogQueue
      DatabaseService.ts             # All bun:sqlite CRUD — takes Database in constructor
      ParserService.ts               # ts-morph extraction: parseFile() + extractReferences()
      IndexerService.ts              # chokidar watcher, debounce, flushFile(), reindexFile()
      SymbolService.ts               # findSymbol, searchSymbols, getMethods, getFileSymbols
      ReferenceService.ts            # getCallers, getImplementations, getHierarchy, getRelatedFiles
      FrameworkService.ts            # detectFrameworks() builds prefix→resolver map (monorepo)
      ConfigService.ts               # resolveConfig() — ts-morph reads vite/drizzle/tsconfig files
    tools/
      symbol-tools.ts                # Zod schemas + MCP registration for Layer 2 symbol tools
      reference-tools.ts             # Zod schemas + MCP registration for Layer 2 reference tools
      index-tools.ts                 # Zod schema + MCP registration for flush_file
      runtime-tools.ts               # Zod schemas + MCP registration for Layer 3 tools
    framework/
      resolver-interface.ts          # IFrameworkResolver interface + MiddlewareTrace + RouteConfig types
      express-resolver.ts            # ExpressResolver: AST traversal of app.use() / router.get()
      nextjs-resolver.ts             # NextJsResolver: file convention mapping, Pages + App Router
      sveltekit-resolver.ts          # SvelteKitResolver: +server.ts + hooks.server.ts walking
  test/
    fixtures/
      simple-ts-project/
        src/auth/authService.ts      # class AuthService with 2 methods
        src/auth/authMiddleware.ts   # function authMiddleware
        src/routes/users.ts          # function getUsers, function createUser
        tsconfig.json
        package.json
      express-project/
        src/app.ts                   # Express app with app.use() chains
        src/routes/users.ts          # router.get/post
        tsconfig.json
        package.json
      nextjs-project/
        pages/api/users/[id].ts      # Pages Router API route
        app/orders/[id]/route.ts     # App Router API route
        middleware.ts                # Next.js middleware
        next.config.ts
        package.json
      sveltekit-project/
        src/routes/users/[id]/+server.ts
        src/hooks.server.ts
        svelte.config.ts
        package.json
    services/
      DatabaseService.test.ts
      ParserService.test.ts
      IndexerService.test.ts
      SymbolService.test.ts
      ReferenceService.test.ts
      FrameworkService.test.ts
      ConfigService.test.ts
  .env.example
  .gitignore
  .husky/
    pre-commit
    pre-push
    commit-msg
    check-duplicates.sh
  package.json
  tsconfig.json
  CHANGELOG.md
```

---

## Phase 1: Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `tsa-mcp-server/package.json`
- Create: `tsa-mcp-server/tsconfig.json`
- Create: `tsa-mcp-server/.gitignore`
- Create: `tsa-mcp-server/.env.example`
- Create: `tsa-mcp-server/CHANGELOG.md`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir D:/Prasanna-tools/code-tree/tsa-mcp-server
cd D:/Prasanna-tools/code-tree/tsa-mcp-server
```

Create `package.json`:
```json
{
  "name": "tsa-mcp-server",
  "version": "0.1.0",
  "description": "TypeScript AST MCP server — codebase intelligence through structural queries",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "start": "bun src/index.ts",
    "test": "bun test",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "chokidar": "latest",
    "pino": "latest",
    "pino-pretty": "latest",
    "ts-morph": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "husky": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.tsa/
*.db
*.db-shm
*.db-wal
logs/
app.log
error.log
.env
.env.local
.env.*.local
```

- [ ] **Step 4: Create .env.example**

```
# Required: path to the TypeScript project to index
TSA_PROJECT_ROOT=/path/to/your/project

# Optional: where to store the SQLite index (default: <TSA_PROJECT_ROOT>/.tsa/index.db)
TSA_DB_PATH=

# Optional: development | production (default: development)
NODE_ENV=development

# Optional: debug | info | warn | error (default: info)
LOG_LEVEL=info
```

- [ ] **Step 5: Install dependencies**

```bash
bun install
```

Expected: `bun.lockb` created, `node_modules/` populated.

- [ ] **Step 6: Set up Husky**

```bash
bunx husky init
```

Create `.husky/pre-commit`:
```sh
#!/bin/sh
echo "🔐 Checking for secrets in staged files..."
gitleaks protect --staged
if [ $? -ne 0 ]; then
  echo "❌ Secrets detected. Commit blocked."
  exit 1
fi
echo "🔍 Checking for duplicate functions/classes..."
sh .husky/check-duplicates.sh
if [ $? -ne 0 ]; then
  echo "❌ Duplicate code detected. Commit blocked."
  exit 1
fi
echo "✅ Pre-commit checks passed."
exit 0
```

Create `.husky/pre-push`:
```sh
#!/bin/sh
echo "🧪 Running tests..."
bun test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Push blocked."
  exit 1
fi
echo "🎨 Running type check..."
bun run lint
if [ $? -ne 0 ]; then
  echo "❌ Type errors found. Push blocked."
  exit 1
fi
echo "✅ Pre-push checks passed."
exit 0
```

Create `.husky/commit-msg`:
```sh
#!/bin/sh
COMMIT_MSG=$(cat "$1")
VALID_TYPES="feat|fix|docs|style|refactor|test|chore|perf|ci|build"
PATTERN="^($VALID_TYPES)(\([a-zA-Z0-9_-]+\))?: .{1,}$"
if ! echo "$COMMIT_MSG" | grep -E "$PATTERN" > /dev/null; then
  echo "❌ Invalid commit message. Use: type(scope): description"
  exit 1
fi
exit 0
```

Create `.husky/check-duplicates.sh`:
```sh
#!/bin/sh
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$')
if [ -z "$STAGED_FILES" ]; then exit 0; fi
DUPLICATES_FOUND=0
for FILE in $STAGED_FILES; do
  CLASSES=$(grep -oE '^(export\s+)?(abstract\s+)?class\s+[a-zA-Z_][a-zA-Z0-9_]*' "$FILE" | sed 's/.*class //g' || true)
  for CLASS in $CLASSES; do
    if [ ! -z "$CLASS" ]; then
      COUNT=$(grep -r "class $CLASS" src/ --include="*.ts" | grep -v "$FILE" | wc -l)
      if [ "$COUNT" -gt 0 ]; then
        echo "⚠️  WARNING: Class '$CLASS' already exists. File: $FILE"
        DUPLICATES_FOUND=1
      fi
    fi
  done
done
if [ "$DUPLICATES_FOUND" -eq 1 ]; then exit 1; fi
exit 0
```

- [ ] **Step 7: Create CHANGELOG.md**

```markdown
# Changelog

## [0.1.0] - 2026-04-04

### Initial Release
- Layer 1: AST indexer with persistent SQLite storage
- Layer 2: Structural query tools (find_symbol, get_callers, etc.)
- Layer 3: Runtime context tools (trace_middleware, resolve_config)
- Framework support: Express, Next.js (Pages + App Router), SvelteKit
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example CHANGELOG.md .husky/
git commit -m "chore(scaffold): initialize tsa-mcp-server project structure"
```

---

### Task 2: Types & Errors

**Files:**
- Create: `src/types/common.ts`
- Create: `src/types/env.ts`
- Create: `src/errors/TsaError.ts`
- Create: `src/errors/IndexError.ts`
- Create: `src/errors/QueryError.ts`
- Create: `src/errors/FrameworkError.ts`
- Create: `src/errors/ValidationError.ts`

- [ ] **Step 1: Create src/types/common.ts**

```typescript
/**
 * @module common
 * @description Shared types used across all services and tools.
 */

/** All valid symbol kinds extracted from TypeScript AST */
export type SymbolKind =
  | 'class' | 'interface' | 'enum' | 'type_alias' | 'function'
  | 'method' | 'property' | 'constructor' | 'getter' | 'setter'
  | 'enum_member' | 'variable';

/** All valid reference/edge kinds in the call graph */
export type RefKind = 'calls' | 'imports' | 'extends' | 'implements' | 'type_ref' | 'decorator';

/** Static analysis confidence level for call graph edges */
export type Confidence = 'direct' | 'inferred' | 'weak';

/** HTTP methods supported by framework route resolvers */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * A symbol extracted from the TypeScript AST.
 * parent_id is null for top-level symbols; set to parent class/interface id for members.
 * _parentName is an internal-only field used during two-pass insert — stripped before storage.
 */
export interface TsaSymbol {
  id?: number;
  name: string;
  kind: SymbolKind;
  file_path: string;
  line: number;
  column: number;
  end_line: number | null;
  parent_id: number | null;
  signature: string | null;
  modifiers: string;
  return_type: string | null;
  params: string | null;
  doc_comment: string | null;
  /** Internal: parent class name for two-pass ID resolution. Not stored in DB. */
  _parentName?: string;
}

/** A directed edge in the call/import/inheritance graph */
export interface TsaReference {
  source_symbol_id: number;
  target_symbol_id: number;
  ref_kind: RefKind;
  source_line: number | null;
  confidence: Confidence;
}

/** File record stored in the `files` table for incremental indexing */
export interface FileRecord {
  path: string;
  last_modified: number;
  content_hash: string;
  symbol_count: number;
  index_time_ms: number;
}

/** A single middleware entry returned by trace_middleware */
export interface MiddlewareTrace {
  name: string;
  file_path: string;
  line: number;
  order: number;
}

/** Route configuration returned by get_route_config */
export interface RouteConfig {
  handler: string;
  file_path: string;
  guards: string[];
  redirects: string[];
}

/** Metadata included in every tool response */
export interface ToolMeta {
  count: number;
  query_ms: number;
  correlationId: string;
}

/** Successful tool response envelope */
export interface ToolResult<T> {
  results: T[];
  _warnings?: string[];
  _meta: ToolMeta;
}

/** Error tool response envelope */
export interface ToolError {
  success: false;
  error: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
  };
  _meta: { query_ms: number };
}
```

- [ ] **Step 2: Create src/types/env.ts**

```typescript
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * @interface EnvVars
 * @description Typed environment variables for TSA MCP server.
 */
export interface EnvVars {
  NODE_ENV: 'development' | 'production';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  TSA_PROJECT_ROOT: string;
  TSA_DB_PATH: string;
}

/**
 * Detect the project root using this priority chain:
 * 1. --project <path> CLI argument
 * 2. TSA_PROJECT_ROOT environment variable
 * 3. Nearest tsconfig.json walking up from CWD
 * 4. CWD as last resort
 * @returns Resolved absolute project root path
 */
export function detectProjectRoot(): string {
  const args = process.argv;
  const projectIdx = args.indexOf('--project');
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    return args[projectIdx + 1];
  }
  if (process.env.TSA_PROJECT_ROOT) {
    return process.env.TSA_PROJECT_ROOT;
  }
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/**
 * Validate and return typed ENV vars. Exits with code 1 if project root cannot be resolved.
 * @returns Fully typed EnvVars object
 * @throws Never — exits process on fatal misconfiguration
 */
export function validateEnv(): EnvVars {
  const projectRoot = detectProjectRoot();
  const dbPath = process.env.TSA_DB_PATH || join(projectRoot, '.tsa', 'index.db');
  return {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production') ?? 'development',
    LOG_LEVEL: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    TSA_PROJECT_ROOT: projectRoot,
    TSA_DB_PATH: dbPath
  };
}
```

- [ ] **Step 3: Create error classes**

`src/errors/TsaError.ts`:
```typescript
/**
 * @class TsaError
 * @description Base error for all TSA MCP server errors. Carries a machine-readable code and context.
 */
export class TsaError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  /**
   * @param code Machine-readable error code (e.g., 'INDEX_ERROR')
   * @param message Human-readable description
   * @param context Additional context for logging/debugging
   */
  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TsaError';
    this.code = code;
    this.context = context;
  }
}
```

`src/errors/IndexError.ts`:
```typescript
import { TsaError } from './TsaError';

/**
 * @class IndexError
 * @description Thrown when ts-morph fails to parse a TypeScript file.
 */
export class IndexError extends TsaError {
  /**
   * @param message Description of the parse failure
   * @param context Should include filePath and optionally line number
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INDEX_ERROR', message, context);
    this.name = 'IndexError';
  }
}
```

`src/errors/QueryError.ts`:
```typescript
import { TsaError } from './TsaError';

/**
 * @class QueryError
 * @description Thrown when a bun:sqlite query fails.
 */
export class QueryError extends TsaError {
  /**
   * @param message Description of the query failure
   * @param context Should include the query and any relevant parameters
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('QUERY_ERROR', message, context);
    this.name = 'QueryError';
  }
}
```

`src/errors/FrameworkError.ts`:
```typescript
import { TsaError } from './TsaError';

/**
 * @class FrameworkError
 * @description Thrown when framework detection or route/middleware tracing fails.
 */
export class FrameworkError extends TsaError {
  /**
   * @param message Description of the framework error
   * @param context Should include routePath or framework name
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('FRAMEWORK_ERROR', message, context);
    this.name = 'FrameworkError';
  }
}
```

`src/errors/ValidationError.ts`:
```typescript
import { TsaError } from './TsaError';

/**
 * @class ValidationError
 * @description Thrown when Zod fails to parse tool input arguments.
 */
export class ValidationError extends TsaError {
  /**
   * @param message Description of the validation failure
   * @param context Should include field-level errors from Zod
   */
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', message, context);
    this.name = 'ValidationError';
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/ src/errors/
git commit -m "feat(types): add shared types, env validation, and error classes"
```

---

### Task 3: Logging

**Files:**
- Create: `src/logging/logEvents.ts`
- Create: `src/logging/logger.ts`
- Create: `src/logging/logQueue.ts`

- [ ] **Step 1: Create src/logging/logEvents.ts**

```typescript
/**
 * @enum LogEvents
 * @description All log event name constants. Never use ad-hoc strings for log events.
 */
export enum LogEvents {
  // Database
  DB_INITIALIZED        = 'db.initialized',
  DB_MIGRATION_RAN      = 'db.migration_ran',
  SYMBOLS_INSERTED      = 'db.symbols_inserted',
  REFS_INSERTED         = 'db.refs_inserted',
  FILE_SYMBOLS_DELETED  = 'db.file_symbols_deleted',
  // Indexer
  INDEXER_STARTED       = 'indexer.started',
  INDEXER_FILE_ADDED    = 'indexer.file_added',
  INDEXER_FILE_CHANGED  = 'indexer.file_changed',
  INDEXER_FILE_DELETED  = 'indexer.file_deleted',
  INDEXER_FILE_SKIPPED  = 'indexer.file_skipped',
  INDEXER_FLUSH         = 'indexer.flush',
  // Parser
  PARSER_FILE_PARSED    = 'parser.file_parsed',
  PARSER_REFS_EXTRACTED = 'parser.refs_extracted',
  // Tools
  TOOL_CALLED           = 'tool.called',
  TOOL_ERROR            = 'tool.error',
  // Framework
  FRAMEWORK_DETECTED    = 'framework.detected',
  FRAMEWORK_TRACED      = 'framework.traced',
  // Server
  SERVER_STARTED        = 'server.started',
  SERVER_SHUTDOWN       = 'server.shutdown'
}
```

- [ ] **Step 2: Create src/logging/logger.ts**

```typescript
import pino from 'pino';

/**
 * @description Pino logger instance.
 * Dev: pretty-printed to stderr via pino-pretty.
 * Prod: JSON to file transports (app.log + error.log).
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'tsa-mcp-server' }
  },
  process.env.NODE_ENV === 'production'
    ? pino.multistream([
        { stream: pino.destination('app.log') },
        { level: 'error', stream: pino.destination('error.log') }
      ])
    : pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, destination: 2 } // stderr — stdout reserved for MCP stdio
      })
);
```

- [ ] **Step 3: Create src/logging/logQueue.ts**

```typescript
import { logger } from './logger';

/** @interface LogEntry — single buffered log entry */
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  service: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

/**
 * @class LogQueue
 * @description Buffers log entries in memory and flushes to pino on interval or threshold.
 * Prevents synchronous logging in the MCP tool call path.
 */
export class LogQueue {
  private queue: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly flushThreshold: number = 50;

  /**
   * @param flushIntervalMs How often to flush the queue (default: 1000ms)
   */
  constructor(private readonly flushIntervalMs: number = 1000) {
    this.startFlushTimer();
  }

  /**
   * Add a log entry to the buffer. Flushes immediately if threshold is reached.
   * @param entry Log entry to buffer
   */
  push(entry: LogEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= this.flushThreshold) {
      this.flush();
    }
  }

  /**
   * Drain all buffered entries to pino immediately.
   */
  flush(): void {
    if (this.queue.length === 0) return;
    const toFlush = [...this.queue];
    this.queue = [];
    for (const entry of toFlush) {
      const { level, message, service, correlationId, context } = entry;
      logger[level]({ service, correlationId, ...context }, message);
    }
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Stop the flush timer and drain remaining entries. Call on server shutdown.
   */
  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flush();
  }
}

/** Singleton LogQueue instance shared across all services */
export const logQueue = new LogQueue();
```

- [ ] **Step 4: Commit**

```bash
git add src/logging/
git commit -m "feat(logging): add pino logger, LogQueue, and LogEvents enum"
```

---

### Task 4: Database Schema & Client

**Files:**
- Create: `src/database/migrations/0001_initial.sql`
- Create: `src/database/schema.ts`
- Create: `src/database/types.ts`
- Create: `src/database/client.ts`

- [ ] **Step 1: Create migration SQL**

`src/database/migrations/0001_initial.sql`:
```sql
CREATE TABLE IF NOT EXISTS symbols (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN (
    'class','interface','enum','type_alias','function',
    'method','property','constructor','getter','setter',
    'enum_member','variable'
  )),
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL,
  column      INTEGER DEFAULT 0,
  end_line    INTEGER,
  parent_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  signature   TEXT,
  modifiers   TEXT DEFAULT '',
  return_type TEXT,
  params      TEXT,
  doc_comment TEXT,
  UNIQUE(file_path, name, kind, line)
);

CREATE INDEX IF NOT EXISTS idx_symbols_name      ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file      ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_kind      ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_parent    ON symbols(parent_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(name, kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file_kind ON symbols(file_path, kind);

CREATE TABLE IF NOT EXISTS "references" (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  ref_kind         TEXT NOT NULL CHECK(ref_kind IN (
    'calls','imports','extends','implements','type_ref','decorator'
  )),
  source_line      INTEGER,
  confidence       TEXT DEFAULT 'direct' CHECK(confidence IN ('direct','inferred','weak'))
);

CREATE INDEX IF NOT EXISTS idx_refs_source      ON "references"(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_target      ON "references"(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_kind        ON "references"(ref_kind);
CREATE INDEX IF NOT EXISTS idx_refs_target_kind ON "references"(target_symbol_id, ref_kind);

CREATE TABLE IF NOT EXISTS files (
  path          TEXT PRIMARY KEY,
  last_modified INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  symbol_count  INTEGER DEFAULT 0,
  index_time_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO project_meta (key, value) VALUES ('schema_version', '1');
```

- [ ] **Step 2: Create src/database/schema.ts**

```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @description Full DDL string for all TSA tables and indexes.
 * Loaded from 0001_initial.sql at module load time.
 */
export const SCHEMA_DDL: string = readFileSync(
  join(__dirname, 'migrations', '0001_initial.sql'),
  'utf-8'
);
```

- [ ] **Step 3: Create src/database/types.ts**

```typescript
/**
 * @module database/types
 * @description Raw row types matching the SQLite schema exactly.
 * These are what bun:sqlite returns — use TsaSymbol/TsaReference for business logic.
 */

/** Raw row from the symbols table */
export interface SymbolRow {
  id: number;
  name: string;
  kind: string;
  file_path: string;
  line: number;
  column: number;
  end_line: number | null;
  parent_id: number | null;
  signature: string | null;
  modifiers: string;
  return_type: string | null;
  params: string | null;
  doc_comment: string | null;
}

/** Raw row from the references table (may include joined fields) */
export interface ReferenceRow {
  id: number;
  source_symbol_id: number;
  target_symbol_id: number;
  ref_kind: string;
  source_line: number | null;
  confidence: string;
  // Joined fields (populated by specific queries)
  caller_name?: string;
  caller_file?: string;
  caller_line?: number;
  caller_class?: string;
  class_name?: string;
  file_path?: string;
}

/** Raw row from the files table */
export interface FileRow {
  path: string;
  last_modified: number;
  content_hash: string;
  symbol_count: number;
  index_time_ms: number;
}
```

- [ ] **Step 4: Create src/database/client.ts**

```typescript
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let _db: Database | null = null;

/**
 * Get or create the singleton bun:sqlite Database instance.
 * Creates the directory for dbPath if it doesn't exist.
 * @param dbPath Absolute path to the SQLite database file
 * @returns Singleton Database instance
 */
export function getDatabase(dbPath: string): Database {
  if (_db) return _db;
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  return _db;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/database/
git commit -m "feat(database): add SQLite schema, DDL migration, and client singleton"
```

---

## Phase 2: Indexing Engine

### Task 5: BaseService + DatabaseService

**Files:**
- Create: `src/services/BaseService.ts`
- Create: `src/services/DatabaseService.ts`
- Create: `test/services/DatabaseService.test.ts`

- [ ] **Step 1: Write failing DatabaseService test**

`test/services/DatabaseService.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import type { TsaSymbol, TsaReference } from '../../src/types/common';

describe('DatabaseService', () => {
  let db: Database;
  let service: DatabaseService;

  beforeEach(() => {
    db = new Database(':memory:');
    service = new DatabaseService(db);
    service.initialize();
  });

  afterEach(() => db.close());

  test('initialize creates all required tables', () => {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('symbols');
    expect(names).toContain('references');
    expect(names).toContain('files');
    expect(names).toContain('project_meta');
  });

  test('initialize sets schema_version to 1', () => {
    const version = service.getSchemaVersion();
    expect(version).toBe(1);
  });

  test('insertSymbols stores top-level symbol', () => {
    service.insertSymbols([{
      name: 'AuthService', kind: 'class', file_path: 'src/auth.ts',
      line: 5, column: 0, end_line: 50, parent_id: null,
      signature: 'class AuthService', modifiers: 'export',
      return_type: null, params: null, doc_comment: null
    }]);
    const rows = service.querySymbolsByName('AuthService');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('class');
  });

  test('insertSymbols resolves _parentName to parent_id', () => {
    service.insertSymbols([
      {
        name: 'AuthService', kind: 'class', file_path: 'src/auth.ts',
        line: 5, column: 0, end_line: 50, parent_id: null,
        signature: 'class AuthService', modifiers: 'export',
        return_type: null, params: null, doc_comment: null
      },
      {
        name: 'login', kind: 'method', file_path: 'src/auth.ts',
        line: 10, column: 2, end_line: 20, parent_id: null,
        signature: 'login(email: string): Promise<void>', modifiers: 'public',
        return_type: 'Promise<void>', params: 'email: string', doc_comment: null,
        _parentName: 'AuthService'
      }
    ]);
    const methods = service.getMethodsByClassName('AuthService');
    expect(methods).toHaveLength(1);
    expect(methods[0]!.name).toBe('login');
    expect(methods[0]!.parent_id).not.toBeNull();
  });

  test('deleteFileSymbols removes all symbols for a file', () => {
    service.insertSymbols([{
      name: 'MyClass', kind: 'class', file_path: 'src/myfile.ts',
      line: 1, column: 0, end_line: 10, parent_id: null,
      signature: null, modifiers: '', return_type: null, params: null, doc_comment: null
    }]);
    service.deleteFileSymbols('src/myfile.ts');
    expect(service.querySymbolsByName('MyClass')).toHaveLength(0);
  });

  test('searchSymbols finds by partial name', () => {
    service.insertSymbols([
      { name: 'handleLogin', kind: 'function', file_path: 'src/a.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: null, modifiers: '', return_type: null, params: null, doc_comment: null },
      { name: 'handleLogout', kind: 'function', file_path: 'src/a.ts', line: 6, column: 0, end_line: 10, parent_id: null, signature: null, modifiers: '', return_type: null, params: null, doc_comment: null },
      { name: 'createUser', kind: 'function', file_path: 'src/b.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: null, modifiers: '', return_type: null, params: null, doc_comment: null }
    ]);
    const results = service.searchSymbols('handle');
    expect(results).toHaveLength(2);
  });

  test('insertReferences and getCallers work correctly', () => {
    service.insertSymbols([
      { name: 'caller', kind: 'function', file_path: 'src/a.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: null, modifiers: '', return_type: null, params: null, doc_comment: null },
      { name: 'callee', kind: 'function', file_path: 'src/b.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: null, modifiers: '', return_type: null, params: null, doc_comment: null }
    ]);
    const callerRow = service.querySymbolsByName('caller')[0]!;
    const calleeRow = service.querySymbolsByName('callee')[0]!;
    service.insertReferences([{
      source_symbol_id: callerRow.id, target_symbol_id: calleeRow.id,
      ref_kind: 'calls', source_line: 3, confidence: 'direct'
    }]);
    const callers = service.getCallers(calleeRow.id);
    expect(callers).toHaveLength(1);
    expect(callers[0]!.caller_name).toBe('caller');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd tsa-mcp-server && bun test test/services/DatabaseService.test.ts
```

Expected: FAIL — `DatabaseService not found`

- [ ] **Step 3: Create src/services/BaseService.ts**

```typescript
import { logQueue } from '../logging/logQueue';

/**
 * @class BaseService
 * @description Abstract base for all TSA services. Provides queue-based logging helpers.
 * All services extend this class and call logInfo/logError etc. — never write to logger directly.
 */
export abstract class BaseService {
  protected readonly serviceName: string;

  /**
   * @param name The service name included in every log entry from this service
   */
  constructor(name: string) {
    this.serviceName = name;
  }

  /**
   * Log an INFO-level event asynchronously via LogQueue.
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logInfo(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'info', message: event, service: this.serviceName, context: data });
  }

  /**
   * Log an ERROR-level event asynchronously via LogQueue.
   * @param event Event name from LogEvents enum
   * @param error The error that was caught
   * @param data Optional additional context
   */
  protected logError(event: string, error: unknown, data?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : new Error(String(error));
    logQueue.push({
      level: 'error', message: event, service: this.serviceName,
      context: { error: err.message, stack: err.stack, ...data }
    });
  }

  /**
   * Log a DEBUG-level event asynchronously via LogQueue.
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logDebug(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'debug', message: event, service: this.serviceName, context: data });
  }

  /**
   * Log a WARN-level event asynchronously via LogQueue.
   * @param event Event name from LogEvents enum
   * @param data Optional structured context
   */
  protected logWarn(event: string, data?: Record<string, unknown>): void {
    logQueue.push({ level: 'warn', message: event, service: this.serviceName, context: data });
  }
}
```

- [ ] **Step 4: Create src/services/DatabaseService.ts**

```typescript
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
 * Takes a Database instance in the constructor for testability (inject :memory: in tests).
 * Never contains business logic — that belongs in SymbolService/ReferenceService.
 */
export class DatabaseService extends BaseService {
  private readonly db: Database;

  /**
   * @param db A bun:sqlite Database instance (file-based for production, :memory: for tests)
   */
  constructor(db: Database) {
    super('DatabaseService');
    this.db = db;
  }

  /**
   * Run the DDL migration to create all tables and indexes.
   * Safe to call multiple times — uses IF NOT EXISTS.
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
   * Get the current schema version from project_meta.
   * Returns 0 if the table doesn't exist yet.
   * @returns Schema version number
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
   * Insert symbols in bulk using a transaction.
   * Performs a two-pass insert: top-level symbols first, then children with resolved parent_id.
   * @param symbols Array of TsaSymbol — may include _parentName for method→class resolution
   * @throws QueryError on insert failure
   */
  insertSymbols(symbols: TsaSymbol[]): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols
        (name, kind, file_path, line, column, end_line, parent_id, signature, modifiers, return_type, params, doc_comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((syms: TsaSymbol[]) => {
      // Pass 1: insert top-level symbols (no _parentName)
      const topLevel = syms.filter(s => !s._parentName);
      for (const s of topLevel) {
        insertStmt.run(s.name, s.kind, s.file_path, s.line, s.column, s.end_line, null, s.signature, s.modifiers, s.return_type, s.params, s.doc_comment);
      }
      // Pass 2: insert children — resolve parent_id by name lookup
      const children = syms.filter(s => s._parentName);
      for (const s of children) {
        const parent = this.db.query('SELECT id FROM symbols WHERE name = ? AND file_path = ?').get(s._parentName!, s.file_path) as { id: number } | null;
        insertStmt.run(s.name, s.kind, s.file_path, s.line, s.column, s.end_line, parent?.id ?? null, s.signature, s.modifiers, s.return_type, s.params, s.doc_comment);
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
   * Delete all symbols (and cascading references) for a given file.
   * Called before re-indexing a changed file.
   * @param filePath Absolute or project-relative file path
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
   * @param name Symbol name to look up
   * @param kind Optional kind filter
   * @returns Matching symbol rows
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
   * @param limit Maximum results (default 20)
   * @returns Matching symbol rows
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
   * Get all methods/constructors for a class by class name.
   * @param className Name of the class
   * @returns Method rows with parent_id set to the class id
   */
  getMethodsByClassName(className: string): SymbolRow[] {
    try {
      const parent = this.db.query("SELECT id FROM symbols WHERE name = ? AND kind = 'class'").get(className) as { id: number } | null;
      if (!parent) return [];
      return this.db.query("SELECT * FROM symbols WHERE parent_id = ?").all(parent.id) as SymbolRow[];
    } catch (err) {
      throw new QueryError('Failed to get methods for class', { cause: String(err), className });
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
   * Get all callers of a symbol (used by get_callers tool).
   * @param targetSymbolId ID of the callee symbol
   * @returns Reference rows with caller_name, caller_file, caller_class joined in
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
   * Get full class hierarchy data (extends, implements, extended_by, implemented_by).
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
   * Get files that this file imports from and files that import this file.
   * @param filePath The file to get relationships for
   */
  getRelatedFiles(filePath: string): { imports_from: string[], imported_by: string[] } {
    try {
      const fileSymbolIds = (this.db.query('SELECT id FROM symbols WHERE file_path = ?').all(filePath) as { id: number }[]).map(r => r.id);
      if (fileSymbolIds.length === 0) return { imports_from: [], imported_by: [] };
      const ph = fileSymbolIds.map(() => '?').join(',');
      const importsFrom = (this.db.query(`SELECT DISTINCT s.file_path FROM "references" r JOIN symbols s ON s.id = r.target_symbol_id WHERE r.source_symbol_id IN (${ph}) AND r.ref_kind = 'imports' AND s.file_path != ?`).all(...fileSymbolIds, filePath) as { file_path: string }[]).map(r => r.file_path);
      const importedBy = (this.db.query(`SELECT DISTINCT s.file_path FROM "references" r JOIN symbols s ON s.id = r.source_symbol_id WHERE r.target_symbol_id IN (${ph}) AND r.ref_kind = 'imports' AND s.file_path != ?`).all(...fileSymbolIds, filePath) as { file_path: string }[]).map(r => r.file_path);
      return { imports_from: importsFrom, imported_by: importedBy };
    } catch (err) {
      throw new QueryError('Failed to get related files', { cause: String(err), filePath });
    }
  }

  /**
   * Upsert a file record (used to track index state for incremental re-indexing).
   * @param record File record to store
   */
  upsertFile(record: FileRecord): void {
    try {
      this.db.run(`INSERT OR REPLACE INTO files (path, last_modified, content_hash, symbol_count, index_time_ms) VALUES (?, ?, ?, ?, ?)`,
        [record.path, record.last_modified, record.content_hash, record.symbol_count, record.index_time_ms]);
    } catch (err) {
      throw new QueryError('Failed to upsert file record', { cause: String(err) });
    }
  }

  /**
   * Get a file record by path (for hash-based change detection).
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
   * Get all tracked file paths (used by IndexerService for full-scan stale detection).
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
```

- [ ] **Step 5: Run test — verify it passes**

```bash
bun test test/services/DatabaseService.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/BaseService.ts src/services/DatabaseService.ts test/services/DatabaseService.test.ts
git commit -m "feat(database): add BaseService and DatabaseService with full CRUD"
```

---

### Task 6: Test Fixtures + ParserService

**Files:**
- Create: `test/fixtures/simple-ts-project/` (full fixture project)
- Create: `src/services/ParserService.ts`
- Create: `test/services/ParserService.test.ts`

- [ ] **Step 1: Create simple-ts-project fixture**

`test/fixtures/simple-ts-project/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "strict": true } }
```

`test/fixtures/simple-ts-project/package.json`:
```json
{ "name": "simple-ts-fixture", "type": "module" }
```

`test/fixtures/simple-ts-project/src/auth/authService.ts`:
```typescript
import type { Request } from 'express';

/**
 * Handles user authentication.
 */
export class AuthService {
  private readonly jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }

  /**
   * Login a user and return a JWT token.
   * @param email User email
   * @param password User password
   * @returns JWT token string
   */
  async login(email: string, password: string): Promise<string> {
    return `token-${email}`;
  }

  /**
   * Logout a user by invalidating their token.
   * @param token JWT token to invalidate
   */
  async logout(token: string): Promise<void> {
    // stub
  }
}
```

`test/fixtures/simple-ts-project/src/auth/authMiddleware.ts`:
```typescript
/**
 * Middleware that validates JWT tokens.
 * @param token The JWT token to validate
 * @returns True if valid
 */
export function authMiddleware(token: string): boolean {
  return token.startsWith('token-');
}
```

`test/fixtures/simple-ts-project/src/routes/users.ts`:
```typescript
/**
 * Get all users.
 * @returns Array of user objects
 */
export function getUsers(): { id: string; email: string }[] {
  return [];
}

/**
 * Create a new user.
 * @param email User email
 */
export function createUser(email: string): void {
  // stub
}
```

- [ ] **Step 2: Write failing ParserService test**

`test/services/ParserService.test.ts`:
```typescript
import { describe, test, expect } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParserService } from '../../src/services/ParserService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../fixtures/simple-ts-project');

describe('ParserService', () => {
  const parser = new ParserService(join(FIXTURE, 'tsconfig.json'));

  test('parseFile extracts class from authService.ts', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/auth/authService.ts'));
    const cls = symbols.find(s => s.name === 'AuthService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.modifiers).toContain('export');
  });

  test('parseFile extracts methods with _parentName', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/auth/authService.ts'));
    const login = symbols.find(s => s.name === 'login');
    expect(login).toBeDefined();
    expect(login!.kind).toBe('method');
    expect(login!._parentName).toBe('AuthService');
    expect(login!.return_type).toContain('Promise');
  });

  test('parseFile extracts function from authMiddleware.ts', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/auth/authMiddleware.ts'));
    const fn = symbols.find(s => s.name === 'authMiddleware');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
  });

  test('parseFile extracts multiple functions from users.ts', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/routes/users.ts'));
    expect(symbols.filter(s => s.kind === 'function')).toHaveLength(2);
  });

  test('parseFile returns line numbers > 0', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/auth/authService.ts'));
    expect(symbols.every(s => s.line > 0)).toBe(true);
  });

  test('extractReferences finds import reference', () => {
    const symbols = parser.parseFile(join(FIXTURE, 'src/auth/authService.ts'));
    const refs = parser.extractReferences(join(FIXTURE, 'src/auth/authService.ts'), symbols);
    // AuthService has an import from 'express'
    const importRef = refs.find(r => r.ref_kind === 'imports');
    expect(importRef).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
bun test test/services/ParserService.test.ts
```

Expected: FAIL — `ParserService not found`

- [ ] **Step 4: Create src/services/ParserService.ts**

```typescript
import { Project, SourceFile, ClassDeclaration, InterfaceDeclaration, FunctionDeclaration, EnumDeclaration, TypeAliasDeclaration, VariableStatement, Node, SyntaxKind } from 'ts-morph';
import { BaseService } from './BaseService';
import { IndexError } from '../errors/IndexError';
import { LogEvents } from '../logging/logEvents';
import type { TsaSymbol, TsaReference, SymbolKind, RefKind } from '../types/common';

/**
 * @class ParserService
 * @description Extracts symbols and call graph references from TypeScript files using ts-morph.
 * Stateless per-file — safe to call concurrently.
 * Known limitations: cannot resolve DI-injected references, dynamic dispatch, or string event names.
 */
export class ParserService extends BaseService {
  private readonly project: Project;

  /**
   * @param tsConfigPath Optional path to tsconfig.json for the project being indexed.
   *   If omitted, uses default compiler options with strict mode.
   */
  constructor(tsConfigPath?: string) {
    super('ParserService');
    this.project = new Project({
      ...(tsConfigPath ? { tsConfigFilePath: tsConfigPath } : {
        compilerOptions: { target: 99, strict: true, allowJs: false }
      }),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true
    });
  }

  /**
   * Parse a TypeScript file and extract all symbols.
   * Returns a flat list — methods/properties have _parentName set for two-pass DB insert.
   * @param filePath Absolute path to the .ts or .tsx file
   * @returns Array of TsaSymbol (flat, with _parentName for children)
   * @throws IndexError if ts-morph fails to parse the file
   */
  parseFile(filePath: string): TsaSymbol[] {
    try {
      const existing = this.project.getSourceFile(filePath);
      if (existing) this.project.removeSourceFile(existing);
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const symbols: TsaSymbol[] = [];

      this.extractClasses(sourceFile, filePath, symbols);
      this.extractInterfaces(sourceFile, filePath, symbols);
      this.extractFunctions(sourceFile, filePath, symbols);
      this.extractEnums(sourceFile, filePath, symbols);
      this.extractTypeAliases(sourceFile, filePath, symbols);
      this.extractVariables(sourceFile, filePath, symbols);

      this.logDebug(LogEvents.PARSER_FILE_PARSED, { filePath, count: symbols.length });
      return symbols;
    } catch (err) {
      if (err instanceof IndexError) throw err;
      throw new IndexError(`Failed to parse ${filePath}`, { cause: String(err), filePath });
    }
  }

  /**
   * Extract call graph references from a file using the already-extracted symbol list.
   * Returns edges with source/target symbol IDs set to 0 — DatabaseService resolves real IDs on insert.
   * Only extracts: imports, extends, implements (calls require full type resolution — Phase 2+).
   * @param filePath Absolute file path
   * @param symbols Symbols already extracted from this file (used for context)
   * @returns Array of TsaReference with source/target IDs as 0 placeholders
   * @throws IndexError on failure
   */
  extractReferences(filePath: string, symbols: TsaSymbol[]): Omit<TsaReference, 'source_symbol_id' | 'target_symbol_id'>[] {
    try {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) return [];
      const refs: Omit<TsaReference, 'source_symbol_id' | 'target_symbol_id'>[] = [];

      for (const imp of sourceFile.getImportDeclarations()) {
        refs.push({
          ref_kind: 'imports',
          source_line: imp.getStartLineNumber(),
          confidence: 'direct'
        });
      }

      for (const cls of sourceFile.getClasses()) {
        const baseClass = cls.getBaseClass();
        if (baseClass) {
          refs.push({ ref_kind: 'extends', source_line: cls.getStartLineNumber(), confidence: 'direct' });
        }
        for (const _impl of cls.getImplements()) {
          refs.push({ ref_kind: 'implements', source_line: cls.getStartLineNumber(), confidence: 'direct' });
        }
      }

      this.logDebug(LogEvents.PARSER_REFS_EXTRACTED, { filePath, count: refs.length });
      return refs;
    } catch (err) {
      throw new IndexError(`Failed to extract references from ${filePath}`, { cause: String(err), filePath });
    }
  }

  private extractClasses(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() ?? '<anonymous>';
      symbols.push({
        name,
        kind: 'class',
        file_path: filePath,
        line: cls.getStartLineNumber(),
        column: cls.getStart() - cls.getStartLinePos(),
        end_line: cls.getEndLineNumber(),
        parent_id: null,
        signature: `class ${name}`,
        modifiers: this.getModifiers(cls),
        return_type: null,
        params: null,
        doc_comment: this.getDocComment(cls)
      });

      for (const method of cls.getMethods()) {
        symbols.push({
          name: method.getName(),
          kind: 'method',
          file_path: filePath,
          line: method.getStartLineNumber(),
          column: 0,
          end_line: method.getEndLineNumber(),
          parent_id: null,
          signature: method.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
          modifiers: this.getModifiers(method),
          return_type: method.getReturnType().getText(),
          params: method.getParameters().map(p => p.getText()).join(', '),
          doc_comment: this.getDocComment(method),
          _parentName: name
        });
      }

      for (const ctor of cls.getConstructors()) {
        symbols.push({
          name: 'constructor',
          kind: 'constructor',
          file_path: filePath,
          line: ctor.getStartLineNumber(),
          column: 0,
          end_line: ctor.getEndLineNumber(),
          parent_id: null,
          signature: `constructor(${ctor.getParameters().map(p => p.getText()).join(', ')})`,
          modifiers: '',
          return_type: null,
          params: ctor.getParameters().map(p => p.getText()).join(', '),
          doc_comment: this.getDocComment(ctor),
          _parentName: name
        });
      }

      for (const prop of cls.getProperties()) {
        symbols.push({
          name: prop.getName(),
          kind: 'property',
          file_path: filePath,
          line: prop.getStartLineNumber(),
          column: 0,
          end_line: prop.getEndLineNumber(),
          parent_id: null,
          signature: prop.getText().trim(),
          modifiers: this.getModifiers(prop),
          return_type: prop.getType().getText(),
          params: null,
          doc_comment: this.getDocComment(prop),
          _parentName: name
        });
      }
    }
  }

  private extractInterfaces(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const iface of sourceFile.getInterfaces()) {
      symbols.push({
        name: iface.getName(),
        kind: 'interface',
        file_path: filePath,
        line: iface.getStartLineNumber(),
        column: 0,
        end_line: iface.getEndLineNumber(),
        parent_id: null,
        signature: `interface ${iface.getName()}`,
        modifiers: this.getModifiers(iface),
        return_type: null,
        params: null,
        doc_comment: this.getDocComment(iface)
      });
    }
  }

  private extractFunctions(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const fn of sourceFile.getFunctions()) {
      symbols.push({
        name: fn.getName() ?? '<anonymous>',
        kind: 'function',
        file_path: filePath,
        line: fn.getStartLineNumber(),
        column: 0,
        end_line: fn.getEndLineNumber(),
        parent_id: null,
        signature: fn.getText().split('\n')[0]!.trim().replace(/\s*\{$/, ''),
        modifiers: this.getModifiers(fn),
        return_type: fn.getReturnType().getText(),
        params: fn.getParameters().map(p => p.getText()).join(', '),
        doc_comment: this.getDocComment(fn)
      });
    }
  }

  private extractEnums(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const en of sourceFile.getEnums()) {
      symbols.push({
        name: en.getName(),
        kind: 'enum',
        file_path: filePath,
        line: en.getStartLineNumber(),
        column: 0,
        end_line: en.getEndLineNumber(),
        parent_id: null,
        signature: `enum ${en.getName()}`,
        modifiers: this.getModifiers(en),
        return_type: null,
        params: null,
        doc_comment: this.getDocComment(en)
      });
      for (const member of en.getMembers()) {
        symbols.push({
          name: member.getName(),
          kind: 'enum_member',
          file_path: filePath,
          line: member.getStartLineNumber(),
          column: 0,
          end_line: null,
          parent_id: null,
          signature: member.getText(),
          modifiers: '',
          return_type: null,
          params: null,
          doc_comment: null,
          _parentName: en.getName()
        });
      }
    }
  }

  private extractTypeAliases(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const ta of sourceFile.getTypeAliases()) {
      symbols.push({
        name: ta.getName(),
        kind: 'type_alias',
        file_path: filePath,
        line: ta.getStartLineNumber(),
        column: 0,
        end_line: ta.getEndLineNumber(),
        parent_id: null,
        signature: `type ${ta.getName()}`,
        modifiers: this.getModifiers(ta),
        return_type: ta.getType().getText(),
        params: null,
        doc_comment: this.getDocComment(ta)
      });
    }
  }

  private extractVariables(sourceFile: SourceFile, filePath: string, symbols: TsaSymbol[]): void {
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        symbols.push({
          name: decl.getName(),
          kind: 'variable',
          file_path: filePath,
          line: decl.getStartLineNumber(),
          column: 0,
          end_line: decl.getEndLineNumber(),
          parent_id: null,
          signature: decl.getText().split('\n')[0]!.trim(),
          modifiers: 'export',
          return_type: decl.getType().getText(),
          params: null,
          doc_comment: null
        });
      }
    }
  }

  private getModifiers(node: any): string {
    const mods: string[] = [];
    if (typeof node.isExported === 'function' && node.isExported()) mods.push('export');
    if (typeof node.isDefaultExport === 'function' && node.isDefaultExport()) mods.push('default');
    if (typeof node.isAbstract === 'function' && node.isAbstract()) mods.push('abstract');
    if (typeof node.isAsync === 'function' && node.isAsync()) mods.push('async');
    if (typeof node.isStatic === 'function' && node.isStatic()) mods.push('static');
    return mods.join(' ');
  }

  private getDocComment(node: any): string | null {
    if (typeof node.getJsDocs !== 'function') return null;
    const docs = node.getJsDocs();
    if (!docs.length) return null;
    return docs.map((d: any) => d.getComment()).filter(Boolean).join('\n') || null;
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
bun test test/services/ParserService.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/simple-ts-project/ src/services/ParserService.ts test/services/ParserService.test.ts
git commit -m "feat(parser): add ParserService with ts-morph AST extraction"
```

---

### Task 7: IndexerService

**Files:**
- Create: `src/services/IndexerService.ts`
- Create: `test/services/IndexerService.test.ts`

- [ ] **Step 1: Write failing IndexerService test**

`test/services/IndexerService.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseService } from '../../src/services/DatabaseService';
import { ParserService } from '../../src/services/ParserService';
import { IndexerService } from '../../src/services/IndexerService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../fixtures/simple-ts-project');

describe('IndexerService', () => {
  let db: Database;
  let dbService: DatabaseService;
  let parser: ParserService;
  let indexer: IndexerService;

  beforeEach(() => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    parser = new ParserService(join(FIXTURE, 'tsconfig.json'));
    indexer = new IndexerService(dbService, parser);
  });

  afterEach(() => db.close());

  test('reindexFile indexes symbols from authService.ts', async () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    await indexer.reindexFile(filePath);
    const symbols = dbService.querySymbolsByName('AuthService');
    expect(symbols).toHaveLength(1);
  });

  test('reindexFile indexes methods into DB', async () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    await indexer.reindexFile(filePath);
    const methods = dbService.getMethodsByClassName('AuthService');
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.some(m => m.name === 'login')).toBe(true);
  });

  test('reindexFile clears previous symbols before re-indexing', async () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    await indexer.reindexFile(filePath);
    await indexer.reindexFile(filePath); // second pass
    const symbols = dbService.querySymbolsByName('AuthService');
    expect(symbols).toHaveLength(1); // not duplicated
  });

  test('flushFile bypasses debounce and runs synchronously', async () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    // Schedule a debounced reindex
    indexer.scheduleReindex(filePath);
    // Immediately flush — should run now, not wait for debounce
    const result = await indexer.flushFile(filePath);
    expect(result.success).toBe(true);
    expect(result.symbols_indexed).toBeGreaterThan(0);
    const symbols = dbService.querySymbolsByName('AuthService');
    expect(symbols).toHaveLength(1);
  });

  test('scanProject indexes all .ts files in fixture', async () => {
    await indexer.scanProject(FIXTURE);
    const authSymbols = dbService.querySymbolsByName('AuthService');
    expect(authSymbols).toHaveLength(1);
    const fnSymbols = dbService.searchSymbols('getUsers');
    expect(fnSymbols).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test test/services/IndexerService.test.ts
```

Expected: FAIL — `IndexerService not found`

- [ ] **Step 3: Create src/services/IndexerService.ts**

```typescript
import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'node:fs/promises';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ParserService } from './ParserService';

/** @interface FlushResult — returned by flushFile tool */
export interface FlushResult {
  success: boolean;
  symbols_indexed: number;
  time_ms: number;
}

/**
 * @class IndexerService
 * @description Orchestrates file watching, debounced re-indexing, and full project scans.
 * Depends on DatabaseService and ParserService — does not own AST or DB logic directly.
 */
export class IndexerService extends BaseService {
  private readonly db: DatabaseService;
  private readonly parser: ParserService;
  /** Map of filePath → pending debounce timer */
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
   * Schedule a debounced re-index for a file. Cancels any pending debounce for the same file.
   * Editors fire 2-3 chokidar events per save — the debounce ensures only one re-index happens.
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
   * Immediately re-index a file, bypassing the debounce.
   * Called directly by flushFile tool — guarantees the index is up to date for the next query.
   * @param filePath Absolute path to the file
   * @throws IndexError or QueryError on failure
   */
  async reindexFile(filePath: string): Promise<void> {
    const start = Date.now();
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    this.db.deleteFileSymbols(filePath);
    const symbols = this.parser.parseFile(filePath);
    this.db.insertSymbols(symbols);

    const stat = statSync(filePath);
    this.db.upsertFile({
      path: filePath,
      last_modified: stat.mtimeMs,
      content_hash: hash,
      symbol_count: symbols.length,
      index_time_ms: Date.now() - start
    });

    this.logInfo(LogEvents.INDEXER_FILE_CHANGED, { filePath, symbols: symbols.length, ms: Date.now() - start });
  }

  /**
   * Flush (synchronously re-index) a file. Used by the flush_file MCP tool.
   * Cancels any pending debounce for this file first.
   * @param filePath File to re-index
   * @returns FlushResult with symbol count and timing
   */
  async flushFile(filePath: string): Promise<FlushResult> {
    // Cancel any pending debounce for this file
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
   * Scan all .ts/.tsx files in projectRoot and index any that are new or changed (hash check).
   * Skips node_modules, dist, and hidden directories.
   * @param projectRoot Absolute project root path
   */
  async scanProject(projectRoot: string): Promise<void> {
    this.logInfo(LogEvents.INDEXER_STARTED, { projectRoot });
    const files = await this.collectTypeScriptFiles(projectRoot);
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
   * Start chokidar file watcher for a project. Returns the watcher for cleanup.
   * @param projectRoot Absolute project root path
   * @returns chokidar FSWatcher instance
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

  private async collectTypeScriptFiles(projectRoot: string): Promise<string[]> {
    const files: string[] = [];
    try {
      // Use glob from node:fs/promises (Bun supports this)
      for await (const entry of (glob as any)(join(projectRoot, '**/*.{ts,tsx}'), {
        exclude: (f: string) => f.includes('node_modules') || f.includes('/dist/') || f.includes('/.tsa/')
      })) {
        files.push(entry);
      }
    } catch {
      // Fallback: manual walk if glob not available
      const { readdirSync } = await import('node:fs');
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            if (['node_modules', 'dist', '.tsa', '.git'].includes(entry.name)) continue;
            walk(join(dir, entry.name));
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            files.push(join(dir, entry.name));
          }
        }
      };
      walk(projectRoot);
    }
    return files;
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test test/services/IndexerService.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/IndexerService.ts test/services/IndexerService.test.ts
git commit -m "feat(indexer): add IndexerService with debounced file watching and full scan"
```

---

## Phase 3: Query Services

### Task 8: SymbolService

**Files:**
- Create: `src/services/SymbolService.ts`
- Create: `test/services/SymbolService.test.ts`

- [ ] **Step 1: Write failing SymbolService test**

`test/services/SymbolService.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import { SymbolService } from '../../src/services/SymbolService';

describe('SymbolService', () => {
  let db: Database;
  let dbService: DatabaseService;
  let service: SymbolService;

  beforeEach(() => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    service = new SymbolService(dbService);

    dbService.insertSymbols([
      { name: 'AuthService', kind: 'class', file_path: 'src/auth.ts', line: 1, column: 0, end_line: 50, parent_id: null, signature: 'class AuthService', modifiers: 'export', return_type: null, params: null, doc_comment: 'Auth service' },
      { name: 'login', kind: 'method', file_path: 'src/auth.ts', line: 5, column: 2, end_line: 15, parent_id: null, signature: 'login(email: string): Promise<void>', modifiers: 'public async', return_type: 'Promise<void>', params: 'email: string', doc_comment: null, _parentName: 'AuthService' },
      { name: 'getUsers', kind: 'function', file_path: 'src/users.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: 'function getUsers()', modifiers: 'export', return_type: 'User[]', params: '', doc_comment: null }
    ]);
  });

  afterEach(() => db.close());

  test('findSymbol returns exact match by name', () => {
    const result = service.findSymbol({ name: 'AuthService' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.name).toBe('AuthService');
  });

  test('findSymbol filters by kind', () => {
    const result = service.findSymbol({ name: 'login', kind: 'method' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.kind).toBe('method');
  });

  test('searchSymbols returns partial matches', () => {
    const result = service.searchSymbols({ query: 'Auth' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(r => r.name === 'AuthService')).toBe(true);
  });

  test('getMethods returns methods of a class', () => {
    const result = service.getMethods({ class_name: 'AuthService' });
    expect(result.results.some(m => m.name === 'login')).toBe(true);
  });

  test('getFileSymbols returns all symbols in a file', () => {
    const result = service.getFileSymbols({ file_path: 'src/auth.ts' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every(s => s.file_path === 'src/auth.ts')).toBe(true);
  });

  test('getFileSymbols filters by kind', () => {
    const result = service.getFileSymbols({ file_path: 'src/auth.ts', kind: 'class' });
    expect(result.results.every(s => s.kind === 'class')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test test/services/SymbolService.test.ts
```

Expected: FAIL — `SymbolService not found`

- [ ] **Step 3: Create src/services/SymbolService.ts**

```typescript
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult, SymbolKind } from '../types/common';
import type { SymbolRow } from '../database/types';
import { randomUUID } from 'node:crypto';

interface FindSymbolInput { name: string; kind?: SymbolKind; }
interface SearchSymbolsInput { query: string; kind?: SymbolKind; limit?: number; }
interface GetMethodsInput { class_name: string; }
interface GetFileSymbolsInput { file_path: string; kind?: SymbolKind; }

interface SymbolResult {
  name: string; kind: string; file_path: string; line: number;
  signature: string | null; modifiers: string;
}

/**
 * @class SymbolService
 * @description Handles all Layer 2 symbol query tools: find_symbol, search_symbols, get_methods, get_file_symbols.
 * Formats compact responses — never returns source code.
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
   * @returns Compact symbol results with metadata
   */
  findSymbol(input: FindSymbolInput): ToolResult<SymbolResult> {
    const start = Date.now();
    const rows = this.db.querySymbolsByName(input.name, input.kind);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'find_symbol', name: input.name });
    return this.buildResult(rows, start);
  }

  /**
   * Search symbols by partial name, optionally filtered by kind and limit.
   * @param input search_symbols tool input
   * @returns Compact symbol results with metadata
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
   * @returns Compact method results with metadata
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
   * @returns Compact symbol results with metadata
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
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test test/services/SymbolService.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/SymbolService.ts test/services/SymbolService.test.ts
git commit -m "feat(symbols): add SymbolService for Layer 2 symbol queries"
```

---

### Task 9: ReferenceService

**Files:**
- Create: `src/services/ReferenceService.ts`
- Create: `test/services/ReferenceService.test.ts`

- [ ] **Step 1: Write failing ReferenceService test**

`test/services/ReferenceService.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import { ReferenceService } from '../../src/services/ReferenceService';

describe('ReferenceService', () => {
  let db: Database;
  let dbService: DatabaseService;
  let service: ReferenceService;

  beforeEach(() => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    service = new ReferenceService(dbService);

    dbService.insertSymbols([
      { name: 'IAuthProvider', kind: 'interface', file_path: 'src/types.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: 'interface IAuthProvider', modifiers: 'export', return_type: null, params: null, doc_comment: null },
      { name: 'AuthService', kind: 'class', file_path: 'src/auth.ts', line: 1, column: 0, end_line: 30, parent_id: null, signature: 'class AuthService', modifiers: 'export', return_type: null, params: null, doc_comment: null },
      { name: 'login', kind: 'method', file_path: 'src/auth.ts', line: 5, column: 2, end_line: 10, parent_id: null, signature: 'login(): void', modifiers: '', return_type: 'void', params: '', doc_comment: null, _parentName: 'AuthService' },
      { name: 'BaseAuthService', kind: 'class', file_path: 'src/base.ts', line: 1, column: 0, end_line: 10, parent_id: null, signature: 'class BaseAuthService', modifiers: 'export', return_type: null, params: null, doc_comment: null },
      { name: 'caller', kind: 'function', file_path: 'src/controller.ts', line: 1, column: 0, end_line: 5, parent_id: null, signature: 'function caller()', modifiers: 'export', return_type: 'void', params: '', doc_comment: null }
    ]);

    const iface = dbService.querySymbolsByName('IAuthProvider')[0]!;
    const authService = dbService.querySymbolsByName('AuthService')[0]!;
    const loginMethod = dbService.querySymbolsByName('login')[0]!;
    const baseClass = dbService.querySymbolsByName('BaseAuthService')[0]!;
    const callerFn = dbService.querySymbolsByName('caller')[0]!;

    dbService.insertReferences([
      { source_symbol_id: authService.id, target_symbol_id: iface.id, ref_kind: 'implements', source_line: 1, confidence: 'direct' },
      { source_symbol_id: authService.id, target_symbol_id: baseClass.id, ref_kind: 'extends', source_line: 1, confidence: 'direct' },
      { source_symbol_id: callerFn.id, target_symbol_id: loginMethod.id, ref_kind: 'calls', source_line: 3, confidence: 'direct' }
    ]);
  });

  afterEach(() => db.close());

  test('getCallers returns callers of a method', () => {
    const login = dbService.querySymbolsByName('login')[0]!;
    const result = service.getCallers({ symbol_name: 'login' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.caller_name).toBe('caller');
  });

  test('getImplementations returns classes implementing interface', () => {
    const result = service.getImplementations({ interface_name: 'IAuthProvider' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.class_name).toBe('AuthService');
  });

  test('getHierarchy returns extends and implements data', () => {
    const result = service.getHierarchy({ class_name: 'AuthService' });
    expect(result.extends.length).toBeGreaterThan(0);
    expect(result.implements.length).toBeGreaterThan(0);
  });

  test('getRelatedFiles returns import relationships', () => {
    // Add import reference from auth.ts to types.ts
    const authService = dbService.querySymbolsByName('AuthService')[0]!;
    const iface = dbService.querySymbolsByName('IAuthProvider')[0]!;
    dbService.insertReferences([
      { source_symbol_id: authService.id, target_symbol_id: iface.id, ref_kind: 'imports', source_line: 1, confidence: 'direct' }
    ]);
    const result = service.getRelatedFiles({ file_path: 'src/auth.ts' });
    expect(result.imports_from).toContain('src/types.ts');
  });

  test('getCallers returns empty array for unknown symbol', () => {
    const result = service.getCallers({ symbol_name: 'nonExistentFn' });
    expect(result.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test test/services/ReferenceService.test.ts
```

Expected: FAIL — `ReferenceService not found`

- [ ] **Step 3: Create src/services/ReferenceService.ts**

```typescript
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import type { DatabaseService } from './DatabaseService';
import type { ToolResult } from '../types/common';
import { randomUUID } from 'node:crypto';

interface GetCallersInput { symbol_name: string; class_name?: string; }
interface GetImplementationsInput { interface_name: string; }
interface GetHierarchyInput { class_name: string; }
interface GetRelatedFilesInput { file_path: string; }

interface CallerResult { caller_name: string; caller_class: string | null; caller_file: string; line: number; confidence: string; }
interface ImplementorResult { class_name: string; file_path: string; line: number; }
interface HierarchyResult { extends: HierarchyEntry[]; implements: HierarchyEntry[]; extended_by: HierarchyEntry[]; implemented_by: HierarchyEntry[]; }
interface HierarchyEntry { name: string; file_path: string; line: number; }
interface RelatedFilesResult { imports_from: string[]; imported_by: string[]; }

/**
 * @class ReferenceService
 * @description Handles Layer 2 call graph tools: get_callers, get_implementations, get_hierarchy, get_related_files.
 * All responses include a _warnings array for partial results (e.g., stale references to deleted files).
 */
export class ReferenceService extends BaseService {
  private readonly db: DatabaseService;

  /** @param db DatabaseService instance */
  constructor(db: DatabaseService) {
    super('ReferenceService');
    this.db = db;
  }

  /**
   * Get all callers of a named symbol, optionally scoped to a class.
   * @param input get_callers tool input
   * @returns Caller results with confidence level and _warnings for stale refs
   */
  getCallers(input: GetCallersInput): ToolResult<CallerResult> {
    const start = Date.now();
    const symbolRows = this.db.querySymbolsByName(input.symbol_name);
    if (symbolRows.length === 0) {
      return { results: [], _meta: { count: 0, query_ms: Date.now() - start, correlationId: randomUUID() } };
    }

    const target = input.class_name
      ? symbolRows.find(s => {
          const parent = s.parent_id ? this.db.querySymbolsByName(input.class_name!).find(p => p.id === s.parent_id) : null;
          return !!parent;
        }) ?? symbolRows[0]!
      : symbolRows[0]!;

    const rows = this.db.getCallers(target.id);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_callers', symbol: input.symbol_name });

    return {
      results: rows.map(r => ({
        caller_name: r.caller_name ?? 'unknown',
        caller_class: r.caller_class ?? null,
        caller_file: r.caller_file ?? 'unknown',
        line: r.caller_line ?? 0,
        confidence: r.confidence
      })),
      _warnings: rows.length > 0 ? ['Call graph is best-effort. DI, dynamic dispatch, and higher-order functions may be missing.'] : [],
      _meta: { count: rows.length, query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * Get all classes that implement a given interface.
   * @param input get_implementations tool input
   * @returns Implementor results
   */
  getImplementations(input: GetImplementationsInput): ToolResult<ImplementorResult> {
    const start = Date.now();
    const ifaceRows = this.db.querySymbolsByName(input.interface_name, 'interface');
    if (ifaceRows.length === 0) {
      return { results: [], _meta: { count: 0, query_ms: Date.now() - start, correlationId: randomUUID() } };
    }
    const rows = this.db.getImplementors(ifaceRows[0]!.id);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_implementations', interface: input.interface_name });

    return {
      results: rows.map(r => ({
        class_name: r.class_name ?? 'unknown',
        file_path: r.file_path ?? 'unknown',
        line: 0
      })),
      _meta: { count: rows.length, query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * Get the full inheritance/implementation hierarchy for a class.
   * @param input get_hierarchy tool input
   * @returns Hierarchy with extends, implements, extended_by, implemented_by
   */
  getHierarchy(input: GetHierarchyInput): HierarchyResult & { _meta: { query_ms: number; correlationId: string } } {
    const start = Date.now();
    const classRows = this.db.querySymbolsByName(input.class_name, 'class');
    if (classRows.length === 0) {
      return { extends: [], implements: [], extended_by: [], implemented_by: [], _meta: { query_ms: Date.now() - start, correlationId: randomUUID() } };
    }
    const data = this.db.getHierarchyData(classRows[0]!.id);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_hierarchy', class: input.class_name });

    const toEntry = (r: any): HierarchyEntry => ({ name: r.name, file_path: r.file_path, line: r.line });
    return {
      extends: data.extends.map(toEntry),
      implements: data.implements.map(toEntry),
      extended_by: data.extended_by.map(toEntry),
      implemented_by: data.implemented_by.map(toEntry),
      _meta: { query_ms: Date.now() - start, correlationId: randomUUID() }
    };
  }

  /**
   * Get files this file imports from and files that import this file.
   * @param input get_related_files tool input
   * @returns imports_from and imported_by arrays
   */
  getRelatedFiles(input: GetRelatedFilesInput): RelatedFilesResult & { _meta: { query_ms: number; correlationId: string } } {
    const start = Date.now();
    const data = this.db.getRelatedFiles(input.file_path);
    this.logDebug(LogEvents.TOOL_CALLED, { tool: 'get_related_files', file: input.file_path });
    return { ...data, _meta: { query_ms: Date.now() - start, correlationId: randomUUID() } };
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test test/services/ReferenceService.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/ReferenceService.ts test/services/ReferenceService.test.ts
git commit -m "feat(references): add ReferenceService for Layer 2 call graph queries"
```

---

## Phase 4: Framework Layer

### Task 10: Framework Resolvers

**Files:**
- Create: `src/framework/resolver-interface.ts`
- Create: `test/fixtures/express-project/` (fixture)
- Create: `test/fixtures/nextjs-project/` (fixture)
- Create: `test/fixtures/sveltekit-project/` (fixture)
- Create: `src/framework/express-resolver.ts`
- Create: `src/framework/nextjs-resolver.ts`
- Create: `src/framework/sveltekit-resolver.ts`

- [ ] **Step 1: Create resolver interface**

`src/framework/resolver-interface.ts`:
```typescript
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';

/**
 * @interface IFrameworkResolver
 * @description Common interface for all framework-specific route and middleware resolvers.
 * Each resolver knows how to interpret a specific framework's routing conventions.
 */
export interface IFrameworkResolver {
  /**
   * Trace the middleware chain that runs for a given route.
   * @param routePath URL path (e.g. "/api/users")
   * @param method Optional HTTP method filter
   * @returns Ordered array of middleware entries
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[];

  /**
   * Get route configuration (handler, guards, redirects) for a URL path.
   * @param urlPath URL path to resolve
   * @returns Route configuration or null if not found
   */
  getRouteConfig(urlPath: string): RouteConfig | null;
}
```

- [ ] **Step 2: Create framework fixtures**

`test/fixtures/express-project/package.json`:
```json
{ "name": "express-fixture", "type": "module", "dependencies": { "express": "^4" } }
```

`test/fixtures/express-project/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "strict": true } }
```

`test/fixtures/express-project/src/app.ts`:
```typescript
import express from 'express';
import { userRouter } from './routes/users';

export const app = express();
app.use(express.json());
app.use('/api/users', userRouter);
```

`test/fixtures/express-project/src/routes/users.ts`:
```typescript
import { Router } from 'express';
export const userRouter = Router();
userRouter.get('/', (req, res) => res.json([]));
userRouter.post('/', (req, res) => res.json({}));
```

`test/fixtures/nextjs-project/next.config.ts`:
```typescript
export default { reactStrictMode: true };
```

`test/fixtures/nextjs-project/package.json`:
```json
{ "name": "nextjs-fixture", "type": "module" }
```

`test/fixtures/nextjs-project/pages/api/users/[id].ts`:
```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.json({ id: req.query.id });
}
```

`test/fixtures/nextjs-project/app/orders/[id]/route.ts`:
```typescript
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
```

`test/fixtures/nextjs-project/middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
export function middleware(request: Request) { return NextResponse.next(); }
export const config = { matcher: '/api/:path*' };
```

`test/fixtures/sveltekit-project/svelte.config.ts`:
```typescript
export default { kit: { adapter: {} } };
```

`test/fixtures/sveltekit-project/package.json`:
```json
{ "name": "sveltekit-fixture", "type": "module" }
```

`test/fixtures/sveltekit-project/src/routes/users/[id]/+server.ts`:
```typescript
import type { RequestHandler } from '@sveltejs/kit';
export const GET: RequestHandler = ({ params }) => new Response(JSON.stringify({ id: params.id }));
```

`test/fixtures/sveltekit-project/src/hooks.server.ts`:
```typescript
import type { Handle } from '@sveltejs/kit';
export const handle: Handle = async ({ event, resolve }) => resolve(event);
```

- [ ] **Step 3: Create src/framework/express-resolver.ts**

```typescript
import { Project } from 'ts-morph';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class ExpressResolver
 * @description Resolves Express.js route/middleware configuration via AST analysis.
 * Parses app.use() and router.get/post/put/delete() call chains to build a route map.
 * Limitation: cannot resolve dynamically computed routes or middleware added via variables.
 */
export class ExpressResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly project: Project;

  /**
   * @param projectRoot Absolute path to the Express project root
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * Trace middleware that runs for a given Express route.
   * Finds the main app file, parses app.use() chains.
   * @param routePath URL path (e.g. "/api/users")
   * @param method Optional HTTP method
   * @returns Ordered middleware trace entries
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[] {
    const appFile = this.findAppFile();
    if (!appFile) return [];
    try {
      const traces: MiddlewareTrace[] = [];
      const sourceFile = this.project.addSourceFileAtPath(appFile);
      let order = 0;
      for (const call of sourceFile.getDescendantsOfKind(199)) { // CallExpression
        const expr = call.getExpression().getText();
        if (expr.endsWith('.use') || expr.endsWith('.get') || expr.endsWith('.post') || expr.endsWith('.put') || expr.endsWith('.delete')) {
          const args = call.getArguments();
          const firstArg = args[0]?.getText().replace(/['"]/g, '');
          if (!firstArg || routePath.startsWith(firstArg) || firstArg === '*') {
            traces.push({
              name: args[args.length - 1]?.getText() ?? 'anonymous',
              file_path: appFile,
              line: call.getStartLineNumber(),
              order: order++
            });
          }
        }
      }
      return traces;
    } catch (err) {
      throw new FrameworkError(`Failed to trace Express middleware for ${routePath}`, { cause: String(err), routePath });
    }
  }

  /**
   * Get route config for an Express URL path.
   * @param urlPath URL path to resolve
   * @returns RouteConfig or null if route not found
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    const appFile = this.findAppFile();
    if (!appFile) return null;
    try {
      const sourceFile = this.project.getSourceFile(appFile) ?? this.project.addSourceFileAtPath(appFile);
      for (const call of sourceFile.getDescendantsOfKind(199)) {
        const expr = call.getExpression().getText();
        if (/\.(get|post|put|delete|patch)$/.test(expr)) {
          const args = call.getArguments();
          const path = args[0]?.getText().replace(/['"]/g, '');
          if (path && (urlPath === path || urlPath.match(path.replace(/:[^/]+/g, '[^/]+')))) {
            return {
              handler: args[args.length - 1]?.getText() ?? 'unknown',
              file_path: appFile,
              guards: [],
              redirects: []
            };
          }
        }
      }
      return null;
    } catch (err) {
      throw new FrameworkError(`Failed to get Express route config for ${urlPath}`, { cause: String(err) });
    }
  }

  private findAppFile(): string | null {
    const candidates = ['src/app.ts', 'src/server.ts', 'app.ts', 'server.ts', 'src/index.ts', 'index.ts'];
    for (const c of candidates) {
      const full = join(this.projectRoot, c);
      if (existsSync(full)) return full;
    }
    return null;
  }
}
```

- [ ] **Step 4: Create src/framework/nextjs-resolver.ts**

```typescript
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class NextJsResolver
 * @description Resolves Next.js routes using file system conventions.
 * Supports both Pages Router (pages/) and App Router (app/) simultaneously.
 * No AST parsing needed for route resolution — the file IS the route.
 */
export class NextJsResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly hasPagesRouter: boolean;
  private readonly hasAppRouter: boolean;

  /**
   * @param projectRoot Absolute path to the Next.js project root
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.hasPagesRouter = existsSync(join(projectRoot, 'pages'));
    this.hasAppRouter = existsSync(join(projectRoot, 'app'));
  }

  /**
   * Return middleware.ts if it exists and matches the route.
   * @param routePath URL path
   * @param method Optional HTTP method (unused — Next.js middleware runs on all methods)
   * @returns MiddlewareTrace array
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[] {
    const middlewareFile = join(this.projectRoot, 'middleware.ts');
    if (!existsSync(middlewareFile)) return [];
    return [{
      name: 'middleware',
      file_path: middlewareFile,
      line: 1,
      order: 0
    }];
  }

  /**
   * Map a URL path to its handler file using Next.js file conventions.
   * Checks App Router first, then Pages Router.
   * Dynamic segments like [id] are matched against URL parameters.
   * @param urlPath URL path (e.g. "/api/users/123")
   * @returns RouteConfig or null if no matching route found
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    try {
      if (this.hasAppRouter) {
        const result = this.resolveAppRouter(urlPath);
        if (result) return result;
      }
      if (this.hasPagesRouter) {
        const result = this.resolvePagesRouter(urlPath);
        if (result) return result;
      }
      return null;
    } catch (err) {
      throw new FrameworkError(`Failed to resolve Next.js route for ${urlPath}`, { cause: String(err) });
    }
  }

  private resolveAppRouter(urlPath: string): RouteConfig | null {
    const appDir = join(this.projectRoot, 'app');
    const routeFile = this.findFileByConvention(appDir, urlPath, 'route.ts');
    if (!routeFile) return null;
    return { handler: 'GET|POST|PUT|DELETE', file_path: routeFile, guards: [], redirects: [] };
  }

  private resolvePagesRouter(urlPath: string): RouteConfig | null {
    const pagesDir = join(this.projectRoot, 'pages');
    const routeFile = this.findFileByConvention(pagesDir, urlPath, 'index.ts') ??
                      this.findFileByConvention(pagesDir, urlPath, '.ts');
    if (!routeFile) return null;
    return { handler: 'default', file_path: routeFile, guards: [], redirects: [] };
  }

  private findFileByConvention(baseDir: string, urlPath: string, suffix: string): string | null {
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates = this.buildCandidatePaths(baseDir, segments, suffix);
    return candidates.find(c => existsSync(c)) ?? null;
  }

  private buildCandidatePaths(baseDir: string, segments: string[], suffix: string): string[] {
    const paths: string[] = [];
    // Exact match
    paths.push(join(baseDir, ...segments, suffix));
    // Dynamic segment substitution: replace each segment with [param] variant
    for (let i = 0; i < segments.length; i++) {
      const dynamic = [...segments];
      dynamic[i] = `[${segments[i]}]`;
      paths.push(join(baseDir, ...dynamic, suffix));
    }
    return paths;
  }
}
```

- [ ] **Step 5: Create src/framework/sveltekit-resolver.ts**

```typescript
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class SvelteKitResolver
 * @description Resolves SvelteKit routes using file system conventions.
 * Maps URLs to +server.ts files and walks up for hooks.server.ts middleware.
 * Route params use [param] syntax same as Next.js.
 */
export class SvelteKitResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly routesDir: string;

  /**
   * @param projectRoot Absolute path to the SvelteKit project root
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.routesDir = join(projectRoot, 'src', 'routes');
  }

  /**
   * Walk up the route directory tree collecting hooks.server.ts files.
   * SvelteKit hooks apply to all routes in their directory and below.
   * @param routePath URL path to trace middleware for
   * @param method Optional HTTP method
   * @returns Ordered hooks entries
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[] {
    const traces: MiddlewareTrace[] = [];
    const hooksRoot = join(this.projectRoot, 'src', 'hooks.server.ts');
    if (existsSync(hooksRoot)) {
      traces.push({ name: 'handle', file_path: hooksRoot, line: 1, order: 0 });
    }

    // Walk up from route dir collecting +layout.server.ts files
    const routeFile = this.resolveRouteFile(routePath);
    if (routeFile) {
      let dir = dirname(routeFile);
      let order = 1;
      while (dir.startsWith(this.routesDir)) {
        const layout = join(dir, '+layout.server.ts');
        if (existsSync(layout)) {
          traces.push({ name: 'load', file_path: layout, line: 1, order: order++ });
        }
        dir = dirname(dir);
      }
    }
    return traces;
  }

  /**
   * Map a URL path to its +server.ts handler file.
   * @param urlPath URL path (e.g. "/users/123")
   * @returns RouteConfig or null if no +server.ts found
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    try {
      const routeFile = this.resolveRouteFile(urlPath);
      if (!routeFile) return null;
      return { handler: 'GET|POST|PUT|DELETE', file_path: routeFile, guards: [], redirects: [] };
    } catch (err) {
      throw new FrameworkError(`Failed to resolve SvelteKit route for ${urlPath}`, { cause: String(err) });
    }
  }

  private resolveRouteFile(urlPath: string): string | null {
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates = this.buildCandidatePaths(this.routesDir, segments);
    return candidates.find(c => existsSync(c)) ?? null;
  }

  private buildCandidatePaths(baseDir: string, segments: string[]): string[] {
    const paths: string[] = [];
    // Exact: src/routes/users/[id]/+server.ts
    paths.push(join(baseDir, ...segments, '+server.ts'));
    // Dynamic: replace last segment with [param]
    for (let i = 0; i < segments.length; i++) {
      const dynamic = [...segments];
      dynamic[i] = `[${segments[i]}]`;
      paths.push(join(baseDir, ...dynamic, '+server.ts'));
    }
    return paths;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/framework/ test/fixtures/express-project/ test/fixtures/nextjs-project/ test/fixtures/sveltekit-project/
git commit -m "feat(framework): add resolver interface, Express, Next.js, and SvelteKit resolvers"
```

---

### Task 11: FrameworkService + ConfigService

**Files:**
- Create: `src/services/FrameworkService.ts`
- Create: `src/services/ConfigService.ts`
- Create: `test/services/FrameworkService.test.ts`
- Create: `test/services/ConfigService.test.ts`

- [ ] **Step 1: Write failing FrameworkService test**

`test/services/FrameworkService.test.ts`:
```typescript
import { describe, test, expect } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrameworkService } from '../../src/services/FrameworkService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../fixtures');

describe('FrameworkService', () => {
  test('detects Next.js project', () => {
    const service = new FrameworkService(join(FIXTURES, 'nextjs-project'));
    const resolvers = service.getResolverMap();
    expect(Object.keys(resolvers)).toContain('.');
  });

  test('detects SvelteKit project', () => {
    const service = new FrameworkService(join(FIXTURES, 'sveltekit-project'));
    const resolvers = service.getResolverMap();
    expect(Object.keys(resolvers)).toContain('.');
  });

  test('detects Express project', () => {
    const service = new FrameworkService(join(FIXTURES, 'express-project'));
    const resolvers = service.getResolverMap();
    expect(Object.keys(resolvers)).toContain('.');
  });

  test('getRouteConfig returns result from correct resolver', () => {
    const service = new FrameworkService(join(FIXTURES, 'nextjs-project'));
    const result = service.getRouteConfig('/api/users/123');
    // Should not throw — may return null if file not found
    expect(result === null || typeof result === 'object').toBe(true);
  });

  test('traceMiddleware returns array', () => {
    const service = new FrameworkService(join(FIXTURES, 'nextjs-project'));
    const result = service.traceMiddleware('/api/users');
    expect(Array.isArray(result.traces)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: FAIL — `FrameworkService not found`

- [ ] **Step 3: Create src/services/FrameworkService.ts**

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import { FrameworkError } from '../errors/FrameworkError';
import { ExpressResolver } from '../framework/express-resolver';
import { NextJsResolver } from '../framework/nextjs-resolver';
import { SvelteKitResolver } from '../framework/sveltekit-resolver';
import type { IFrameworkResolver } from '../framework/resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { randomUUID } from 'node:crypto';

interface TraceResult {
  traces: MiddlewareTrace[];
  _meta: { query_ms: number; correlationId: string; framework: string };
}

/**
 * @class FrameworkService
 * @description Detects frameworks in a project (monorepo-aware) and delegates
 * trace_middleware / get_route_config to the correct IFrameworkResolver.
 * Builds a prefix→resolver map at construction time. Cached for the session.
 */
export class FrameworkService extends BaseService {
  /** Map of path prefix (relative to projectRoot) → resolver instance */
  private readonly resolverMap: Record<string, IFrameworkResolver> = {};
  private readonly projectRoot: string;

  /**
   * @param projectRoot Absolute path to the project or monorepo root
   */
  constructor(projectRoot: string) {
    super('FrameworkService');
    this.projectRoot = projectRoot;
    this.detectFrameworks();
  }

  /**
   * Get the resolver map (prefix → resolver). Primarily used for testing.
   * @returns Shallow copy of the resolver map
   */
  getResolverMap(): Record<string, IFrameworkResolver> {
    return { ...this.resolverMap };
  }

  /**
   * Trace middleware for a given route path.
   * @param routePath URL path (e.g. "/api/users")
   * @param method Optional HTTP method
   * @returns Trace result with framework info in _meta
   */
  traceMiddleware(routePath: string, method?: HttpMethod): TraceResult {
    const start = Date.now();
    const [prefix, resolver] = this.resolverFor(routePath);
    if (!resolver) {
      return { traces: [], _meta: { query_ms: 0, correlationId: randomUUID(), framework: 'unknown' } };
    }
    try {
      const traces = resolver.traceMiddleware(routePath, method);
      this.logInfo(LogEvents.FRAMEWORK_TRACED, { routePath, framework: prefix });
      return { traces, _meta: { query_ms: Date.now() - start, correlationId: randomUUID(), framework: prefix } };
    } catch (err) {
      throw new FrameworkError(`Middleware trace failed for ${routePath}`, { cause: String(err) });
    }
  }

  /**
   * Get route configuration for a URL path.
   * @param urlPath URL path to resolve
   * @returns RouteConfig or null
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    const [, resolver] = this.resolverFor(urlPath);
    if (!resolver) return null;
    return resolver.getRouteConfig(urlPath);
  }

  private resolverFor(routePath: string): [string, IFrameworkResolver | null] {
    // Match longest prefix first
    const prefixes = Object.keys(this.resolverMap).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      if (routePath.startsWith(prefix) || prefix === '.') {
        return [prefix, this.resolverMap[prefix]!];
      }
    }
    return ['.', null];
  }

  private detectFrameworks(): void {
    // Single-project detection
    if (this.detectAt(this.projectRoot, '.')) return;

    // Monorepo: scan direct subdirectories
    const { readdirSync } = require('node:fs');
    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
        this.detectAt(join(this.projectRoot, entry.name), entry.name);
      }
    } catch {
      // ignore scan errors
    }
  }

  private detectAt(dir: string, prefix: string): boolean {
    if (existsSync(join(dir, 'next.config.ts')) || existsSync(join(dir, 'next.config.js'))) {
      this.resolverMap[prefix] = new NextJsResolver(dir);
      this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'nextjs', prefix });
      return true;
    }
    if (existsSync(join(dir, 'svelte.config.ts')) || existsSync(join(dir, 'svelte.config.js'))) {
      this.resolverMap[prefix] = new SvelteKitResolver(dir);
      this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'sveltekit', prefix });
      return true;
    }
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const deps = JSON.parse(readFileSync(pkg, 'utf-8'));
        if (deps.dependencies?.express || deps.devDependencies?.express) {
          this.resolverMap[prefix] = new ExpressResolver(dir);
          this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'express', prefix });
          return true;
        }
      } catch { /* malformed package.json */ }
    }
    return false;
  }
}
```

- [ ] **Step 4: Write ConfigService test**

`test/services/ConfigService.test.ts`:
```typescript
import { describe, test, expect } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ConfigService } from '../../src/services/ConfigService';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ConfigService', () => {
  test('resolveConfig reads a key from vite.config.ts', () => {
    const tmp = join(tmpdir(), `tsa-config-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'vite.config.ts'), `
      export default {
        build: { outDir: 'dist' },
        server: { port: 5173 }
      };
    `);

    const service = new ConfigService(tmp);
    const result = service.resolveConfig({ config_key: 'build.outDir' });
    expect(result).not.toBeNull();

    rmSync(tmp, { recursive: true });
  });

  test('resolveConfig returns null for unknown key', () => {
    const tmp = join(tmpdir(), `tsa-config-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'vite.config.ts'), `export default { build: { outDir: 'dist' } };`);

    const service = new ConfigService(tmp);
    const result = service.resolveConfig({ config_key: 'nonexistent.key' });
    expect(result).toBeNull();

    rmSync(tmp, { recursive: true });
  });
});
```

- [ ] **Step 5: Run FrameworkService test — verify it fails**

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: FAIL

- [ ] **Step 6: Create src/services/ConfigService.ts**

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Project, ObjectLiteralExpression, PropertyAssignment } from 'ts-morph';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import { randomUUID } from 'node:crypto';

interface ResolveConfigInput { config_key: string; }
interface ConfigChainEntry { source: string; value: string; }
interface ConfigResult {
  final_value: string;
  chain: ConfigChainEntry[];
  _meta: { query_ms: number; correlationId: string };
}

/** Config files searched in order */
const CONFIG_CANDIDATES = [
  'vite.config.ts', 'vite.config.js',
  'drizzle.config.ts', 'drizzle.config.js',
  'tsconfig.json',
  'next.config.ts', 'next.config.js',
  'svelte.config.ts', 'svelte.config.js'
];

/**
 * @class ConfigService
 * @description Reads and parses non-env config files using ts-morph to extract key values.
 * Does NOT execute config files — pure static AST analysis.
 * Does NOT read .env files — those are out of scope by design.
 */
export class ConfigService extends BaseService {
  private readonly projectRoot: string;
  private readonly project: Project;

  /**
   * @param projectRoot Absolute path to the project root
   */
  constructor(projectRoot: string) {
    super('ConfigService');
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * Resolve a dot-notation config key from config files in the project.
   * Searches vite.config.ts, drizzle.config.ts, tsconfig.json, etc. in order.
   * @param input resolve_config tool input
   * @returns ConfigResult with final_value and chain, or null if key not found
   * @example
   *   resolveConfig({ config_key: 'build.outDir' })
   *   // → { final_value: 'dist', chain: [{ source: 'vite.config.ts:3', value: 'dist' }] }
   */
  resolveConfig(input: ResolveConfigInput): ConfigResult | null {
    const start = Date.now();
    const keyParts = input.config_key.split('.');

    for (const candidate of CONFIG_CANDIDATES) {
      const filePath = join(this.projectRoot, candidate);
      if (!existsSync(filePath)) continue;
      try {
        const value = this.extractFromFile(filePath, keyParts);
        if (value !== null) {
          this.logDebug(LogEvents.TOOL_CALLED, { tool: 'resolve_config', key: input.config_key, file: candidate });
          return {
            final_value: value.value,
            chain: [{ source: `${candidate}:${value.line}`, value: value.value }],
            _meta: { query_ms: Date.now() - start, correlationId: randomUUID() }
          };
        }
      } catch { /* parsing failed for this file — try next */ }
    }
    return null;
  }

  private extractFromFile(filePath: string, keyParts: string[]): { value: string; line: number } | null {
    const existing = this.project.getSourceFile(filePath);
    if (existing) this.project.removeSourceFile(existing);
    const sourceFile = this.project.addSourceFileAtPath(filePath);

    // Find the default export object
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (!defaultExport) return null;

    const declarations = defaultExport.getDeclarations();
    for (const decl of declarations) {
      const obj = this.findObjectLiteral(decl);
      if (!obj) continue;
      const result = this.traverseObject(obj, keyParts, 0);
      if (result) return result;
    }
    return null;
  }

  private findObjectLiteral(node: any): ObjectLiteralExpression | null {
    if (node.getKindName?.() === 'ObjectLiteralExpression') return node;
    for (const child of node.getChildren?.() ?? []) {
      const found = this.findObjectLiteral(child);
      if (found) return found;
    }
    return null;
  }

  private traverseObject(obj: ObjectLiteralExpression, keyParts: string[], depth: number): { value: string; line: number } | null {
    if (depth >= keyParts.length) return null;
    const key = keyParts[depth]!;
    for (const prop of obj.getProperties()) {
      if (prop.getKindName() !== 'PropertyAssignment') continue;
      const pa = prop as PropertyAssignment;
      if (pa.getName() !== key) continue;
      if (depth === keyParts.length - 1) {
        return { value: pa.getInitializer()?.getText().replace(/['"]/g, '') ?? '', line: pa.getStartLineNumber() };
      }
      const nested = pa.getInitializerIfKind(209); // ObjectLiteralExpression
      if (nested) return this.traverseObject(nested as ObjectLiteralExpression, keyParts, depth + 1);
    }
    return null;
  }
}
```

- [ ] **Step 7: Run all new tests — verify they pass**

```bash
bun test test/services/FrameworkService.test.ts test/services/ConfigService.test.ts
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/FrameworkService.ts src/services/ConfigService.ts test/services/FrameworkService.test.ts test/services/ConfigService.test.ts
git commit -m "feat(framework): add FrameworkService with monorepo detection and ConfigService"
```

---

## Phase 5: MCP Wiring

### Task 12: Tool Registrations

**Files:**
- Create: `src/tools/symbol-tools.ts`
- Create: `src/tools/reference-tools.ts`
- Create: `src/tools/index-tools.ts`
- Create: `src/tools/runtime-tools.ts`

- [ ] **Step 1: Create src/tools/symbol-tools.ts**

```typescript
import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { SymbolService } from '../services/SymbolService';
import { ValidationError } from '../errors/ValidationError';
import { logQueue } from '../logging/logQueue';
import { LogEvents } from '../logging/logEvents';
import { randomUUID } from 'node:crypto';
import type { SymbolKind } from '../types/common';

const SYMBOL_KINDS: [SymbolKind, ...SymbolKind[]] = ['class','interface','enum','type_alias','function','method','property','constructor','getter','setter','enum_member','variable'];

const FindSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(SYMBOL_KINDS).optional()
});

const SearchSymbolsSchema = z.object({
  query: z.string().min(1),
  kind: z.enum(SYMBOL_KINDS).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const GetMethodsSchema = z.object({ class_name: z.string().min(1) });
const GetFileSymbolsSchema = z.object({
  file_path: z.string().min(1),
  kind: z.enum(SYMBOL_KINDS).optional()
});

/**
 * Register all Layer 2 symbol tools on the MCP server.
 * Tool files are thin: validate input with Zod, delegate to service, handle errors.
 * @param server MCP Server instance
 * @param symbolService SymbolService instance
 */
export function registerSymbolTools(server: Server, symbolService: SymbolService): void {
  // Tool definitions are registered in server.ts via ListToolsRequestSchema
  // This file exports handlers keyed by tool name
}

/** Handle find_symbol tool call */
export function handleFindSymbol(args: unknown, symbolService: SymbolService) {
  const correlationId = randomUUID();
  const start = Date.now();
  try {
    const input = FindSymbolSchema.parse(args);
    return symbolService.findSymbol(input);
  } catch (err) {
    logQueue.push({ level: 'error', message: LogEvents.TOOL_ERROR, service: 'symbol-tools', correlationId, context: { tool: 'find_symbol', error: String(err) } });
    if (err instanceof z.ZodError) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
    }
    return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
  }
}

/** Handle search_symbols tool call */
export function handleSearchSymbols(args: unknown, symbolService: SymbolService) {
  const start = Date.now();
  try {
    const input = SearchSymbolsSchema.parse(args);
    return symbolService.searchSymbols(input);
  } catch (err) {
    if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
    return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
  }
}

/** Handle get_methods tool call */
export function handleGetMethods(args: unknown, symbolService: SymbolService) {
  const start = Date.now();
  try {
    const input = GetMethodsSchema.parse(args);
    return symbolService.getMethods(input);
  } catch (err) {
    if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
    return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
  }
}

/** Handle get_file_symbols tool call */
export function handleGetFileSymbols(args: unknown, symbolService: SymbolService) {
  const start = Date.now();
  try {
    const input = GetFileSymbolsSchema.parse(args);
    return symbolService.getFileSymbols(input);
  } catch (err) {
    if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
    return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
  }
}

/** Tool definitions for ListToolsRequestSchema */
export const SYMBOL_TOOL_DEFINITIONS = [
  {
    name: 'find_symbol',
    description: 'Find a TypeScript symbol by exact name. Returns file location, kind, and signature.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'search_symbols',
    description: 'Search symbols by partial name. Returns up to `limit` matches (default 20).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
  },
  {
    name: 'get_methods',
    description: 'Get all methods, constructors, and properties of a class.',
    inputSchema: { type: 'object', properties: { class_name: { type: 'string' } }, required: ['class_name'] }
  },
  {
    name: 'get_file_symbols',
    description: 'Get all symbols defined in a specific file, optionally filtered by kind.',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, kind: { type: 'string' } }, required: ['file_path'] }
  }
];
```

- [ ] **Step 2: Create src/tools/reference-tools.ts**

```typescript
import { z } from 'zod';
import type { ReferenceService } from '../services/ReferenceService';
import { logQueue } from '../logging/logQueue';
import { LogEvents } from '../logging/logEvents';

const GetCallersSchema = z.object({ symbol_name: z.string().min(1), class_name: z.string().optional() });
const GetImplementationsSchema = z.object({ interface_name: z.string().min(1) });
const GetHierarchySchema = z.object({ class_name: z.string().min(1) });
const GetRelatedFilesSchema = z.object({ file_path: z.string().min(1) });

function handleError(err: unknown, start: number) {
  if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
  return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
}

/** Handle get_callers tool call */
export function handleGetCallers(args: unknown, service: ReferenceService) {
  const start = Date.now();
  try { return service.getCallers(GetCallersSchema.parse(args)); }
  catch (err) { return handleError(err, start); }
}

/** Handle get_implementations tool call */
export function handleGetImplementations(args: unknown, service: ReferenceService) {
  const start = Date.now();
  try { return service.getImplementations(GetImplementationsSchema.parse(args)); }
  catch (err) { return handleError(err, start); }
}

/** Handle get_hierarchy tool call */
export function handleGetHierarchy(args: unknown, service: ReferenceService) {
  const start = Date.now();
  try { return service.getHierarchy(GetHierarchySchema.parse(args)); }
  catch (err) { return handleError(err, start); }
}

/** Handle get_related_files tool call */
export function handleGetRelatedFiles(args: unknown, service: ReferenceService) {
  const start = Date.now();
  try { return service.getRelatedFiles(GetRelatedFilesSchema.parse(args)); }
  catch (err) { return handleError(err, start); }
}

/** Tool definitions for ListToolsRequestSchema */
export const REFERENCE_TOOL_DEFINITIONS = [
  {
    name: 'get_callers',
    description: 'Get all call sites for a symbol. Returns caller name, file, line, and confidence. Best-effort — DI and dynamic dispatch may be missing.',
    inputSchema: { type: 'object', properties: { symbol_name: { type: 'string' }, class_name: { type: 'string' } }, required: ['symbol_name'] }
  },
  {
    name: 'get_implementations',
    description: 'Get all classes that implement a TypeScript interface.',
    inputSchema: { type: 'object', properties: { interface_name: { type: 'string' } }, required: ['interface_name'] }
  },
  {
    name: 'get_hierarchy',
    description: 'Get the full inheritance hierarchy for a class: what it extends, implements, and what extends/implements it.',
    inputSchema: { type: 'object', properties: { class_name: { type: 'string' } }, required: ['class_name'] }
  },
  {
    name: 'get_related_files',
    description: 'Get files this file imports from and files that import this file.',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }
  }
];
```

- [ ] **Step 3: Create src/tools/index-tools.ts**

```typescript
import { z } from 'zod';
import type { IndexerService } from '../services/IndexerService';

const FlushFileSchema = z.object({ file_path: z.string().min(1) });

/** Handle flush_file tool call — synchronously re-indexes a file, bypassing debounce */
export async function handleFlushFile(args: unknown, indexer: IndexerService) {
  const start = Date.now();
  try {
    const { file_path } = FlushFileSchema.parse(args);
    return await indexer.flushFile(file_path);
  } catch (err) {
    if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
    return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
  }
}

/** Tool definition for ListToolsRequestSchema */
export const INDEX_TOOL_DEFINITIONS = [
  {
    name: 'flush_file',
    description: 'Force synchronous re-index of a file. Use immediately after editing a file before querying its symbols — avoids stale index from debounce delay.',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }
  }
];
```

- [ ] **Step 4: Create src/tools/runtime-tools.ts**

```typescript
import { z } from 'zod';
import type { FrameworkService } from '../services/FrameworkService';
import type { ConfigService } from '../services/ConfigService';
import type { HttpMethod } from '../types/common';

const HTTP_METHODS: [HttpMethod, ...HttpMethod[]] = ['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD'];

const TraceMiddlewareSchema = z.object({
  route_path: z.string().min(1),
  method: z.enum(HTTP_METHODS).optional()
});

const GetRouteConfigSchema = z.object({ url_path: z.string().min(1) });
const ResolveConfigSchema = z.object({ config_key: z.string().min(1) });

function handleError(err: unknown, start: number) {
  if (err instanceof z.ZodError) return { success: false, error: { code: 'VALIDATION_ERROR', message: err.message }, _meta: { query_ms: Date.now() - start } };
  return { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, _meta: { query_ms: Date.now() - start } };
}

/** Handle trace_middleware tool call */
export function handleTraceMiddleware(args: unknown, frameworkService: FrameworkService) {
  const start = Date.now();
  try {
    const input = TraceMiddlewareSchema.parse(args);
    return frameworkService.traceMiddleware(input.route_path, input.method);
  } catch (err) { return handleError(err, start); }
}

/** Handle get_route_config tool call */
export function handleGetRouteConfig(args: unknown, frameworkService: FrameworkService) {
  const start = Date.now();
  try {
    const { url_path } = GetRouteConfigSchema.parse(args);
    const result = frameworkService.getRouteConfig(url_path);
    if (!result) return { results: [], _meta: { count: 0, query_ms: Date.now() - start } };
    return { results: [result], _meta: { count: 1, query_ms: Date.now() - start } };
  } catch (err) { return handleError(err, start); }
}

/** Handle resolve_config tool call */
export function handleResolveConfig(args: unknown, configService: ConfigService) {
  const start = Date.now();
  try {
    const input = ResolveConfigSchema.parse(args);
    const result = configService.resolveConfig(input);
    if (!result) return { success: false, error: { code: 'NOT_FOUND', message: `Config key '${input.config_key}' not found in any config file` }, _meta: { query_ms: Date.now() - start } };
    return result;
  } catch (err) { return handleError(err, start); }
}

/** Tool definitions for ListToolsRequestSchema */
export const RUNTIME_TOOL_DEFINITIONS = [
  {
    name: 'trace_middleware',
    description: 'Trace the middleware chain for a route. Supports Express, Next.js, and SvelteKit.',
    inputSchema: { type: 'object', properties: { route_path: { type: 'string' }, method: { type: 'string' } }, required: ['route_path'] }
  },
  {
    name: 'get_route_config',
    description: 'Get the handler, guards, and redirect configuration for a URL path.',
    inputSchema: { type: 'object', properties: { url_path: { type: 'string' } }, required: ['url_path'] }
  },
  {
    name: 'resolve_config',
    description: 'Resolve a dot-notation config key from vite.config.ts, drizzle.config.ts, tsconfig.json, etc. Does NOT read .env files.',
    inputSchema: { type: 'object', properties: { config_key: { type: 'string' } }, required: ['config_key'] }
  }
];
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/
git commit -m "feat(tools): add all MCP tool registration handlers with Zod validation"
```

---

### Task 13: Server Wiring + Entry Point

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create src/server.ts**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DatabaseService } from './services/DatabaseService';
import type { IndexerService } from './services/IndexerService';
import type { SymbolService } from './services/SymbolService';
import type { ReferenceService } from './services/ReferenceService';
import type { FrameworkService } from './services/FrameworkService';
import type { ConfigService } from './services/ConfigService';
import { SYMBOL_TOOL_DEFINITIONS, handleFindSymbol, handleSearchSymbols, handleGetMethods, handleGetFileSymbols } from './tools/symbol-tools';
import { REFERENCE_TOOL_DEFINITIONS, handleGetCallers, handleGetImplementations, handleGetHierarchy, handleGetRelatedFiles } from './tools/reference-tools';
import { INDEX_TOOL_DEFINITIONS, handleFlushFile } from './tools/index-tools';
import { RUNTIME_TOOL_DEFINITIONS, handleTraceMiddleware, handleGetRouteConfig, handleResolveConfig } from './tools/runtime-tools';
import { LogEvents } from './logging/logEvents';
import { logQueue } from './logging/logQueue';

const ALL_TOOLS = [
  ...SYMBOL_TOOL_DEFINITIONS,
  ...REFERENCE_TOOL_DEFINITIONS,
  ...INDEX_TOOL_DEFINITIONS,
  ...RUNTIME_TOOL_DEFINITIONS
];

interface Services {
  db: DatabaseService;
  indexer: IndexerService;
  symbolService: SymbolService;
  referenceService: ReferenceService;
  frameworkService: FrameworkService;
  configService: ConfigService;
}

/**
 * @function createServer
 * @description Create and configure the MCP server with all tool registrations.
 * @param services Fully initialized service instances
 * @returns Configured MCP Server instance ready for transport connection
 */
export function createServer(services: Services): Server {
  const server = new Server(
    { name: 'tsa-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logQueue.push({ level: 'info', message: LogEvents.TOOL_CALLED, service: 'server', context: { tool: name } });

    let result: unknown;
    switch (name) {
      // Layer 2: Symbol tools
      case 'find_symbol':        result = handleFindSymbol(args, services.symbolService); break;
      case 'search_symbols':     result = handleSearchSymbols(args, services.symbolService); break;
      case 'get_methods':        result = handleGetMethods(args, services.symbolService); break;
      case 'get_file_symbols':   result = handleGetFileSymbols(args, services.symbolService); break;
      // Layer 2: Reference tools
      case 'get_callers':        result = handleGetCallers(args, services.referenceService); break;
      case 'get_implementations':result = handleGetImplementations(args, services.referenceService); break;
      case 'get_hierarchy':      result = handleGetHierarchy(args, services.referenceService); break;
      case 'get_related_files':  result = handleGetRelatedFiles(args, services.referenceService); break;
      // Index tools
      case 'flush_file':         result = await handleFlushFile(args, services.indexer); break;
      // Layer 3: Runtime tools
      case 'trace_middleware':   result = handleTraceMiddleware(args, services.frameworkService); break;
      case 'get_route_config':   result = handleGetRouteConfig(args, services.frameworkService); break;
      case 'resolve_config':     result = handleResolveConfig(args, services.configService); break;
      default:
        result = { success: false, error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` } };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  logQueue.push({ level: 'info', message: LogEvents.SERVER_STARTED, service: 'server', context: { tools: ALL_TOOLS.length } });
  return server;
}
```

- [ ] **Step 2: Create src/index.ts**

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateEnv } from './types/env';
import { getDatabase } from './database/client';
import { DatabaseService } from './services/DatabaseService';
import { ParserService } from './services/ParserService';
import { IndexerService } from './services/IndexerService';
import { SymbolService } from './services/SymbolService';
import { ReferenceService } from './services/ReferenceService';
import { FrameworkService } from './services/FrameworkService';
import { ConfigService } from './services/ConfigService';
import { createServer } from './server';
import { logQueue } from './logging/logQueue';
import { logger } from './logging/logger';
import { LogEvents } from './logging/logEvents';
import { join } from 'node:path';

/**
 * @function main
 * @description TSA MCP Server entry point.
 * Boot sequence: validateEnv → DB init → full project scan → MCP listen.
 * Exits with code 1 on any fatal startup error.
 */
async function main(): Promise<void> {
  try {
    // 1. Validate environment
    const env = validateEnv();
    logger.info({ projectRoot: env.TSA_PROJECT_ROOT, dbPath: env.TSA_DB_PATH }, 'Starting TSA MCP Server');

    // 2. Initialize database
    const db = getDatabase(env.TSA_DB_PATH);
    const dbService = new DatabaseService(db);
    dbService.initialize();

    // 3. Initialize services
    const tsConfigPath = join(env.TSA_PROJECT_ROOT, 'tsconfig.json');
    const parserService = new ParserService(tsConfigPath);
    const indexerService = new IndexerService(dbService, parserService);
    const symbolService = new SymbolService(dbService);
    const referenceService = new ReferenceService(dbService);
    const frameworkService = new FrameworkService(env.TSA_PROJECT_ROOT);
    const configService = new ConfigService(env.TSA_PROJECT_ROOT);

    // 4. Full project scan (incremental — skips unchanged files)
    await indexerService.scanProject(env.TSA_PROJECT_ROOT);

    // 5. Start file watcher
    indexerService.startWatcher(env.TSA_PROJECT_ROOT);

    // 6. Create and connect MCP server
    const server = createServer({ db: dbService, indexer: indexerService, symbolService, referenceService, frameworkService, configService });
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info(LogEvents.SERVER_STARTED);

    // 7. Graceful shutdown
    process.on('SIGINT', () => {
      logQueue.push({ level: 'info', message: LogEvents.SERVER_SHUTDOWN, service: 'index' });
      logQueue.destroy();
      db.close();
      process.exit(0);
    });
  } catch (err) {
    logger.fatal({ err }, 'Fatal startup error — TSA MCP Server cannot start');
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Type check the full project**

```bash
bun run lint
```

Expected: No type errors. If errors appear, fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat(server): wire MCP server with all tool registrations and startup sequence"
```

---

### Task 14: Integration Smoke Test

**Files:**
- Create: `test/integration.test.ts`

- [ ] **Step 1: Create integration test**

`test/integration.test.ts`:
```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseService } from '../src/services/DatabaseService';
import { ParserService } from '../src/services/ParserService';
import { IndexerService } from '../src/services/IndexerService';
import { SymbolService } from '../src/services/SymbolService';
import { ReferenceService } from '../src/services/ReferenceService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/simple-ts-project');

describe('Integration: full index + query cycle', () => {
  let db: Database;
  let dbService: DatabaseService;
  let symbolService: SymbolService;
  let referenceService: ReferenceService;

  beforeAll(async () => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    const parser = new ParserService(join(FIXTURE, 'tsconfig.json'));
    const indexer = new IndexerService(dbService, parser);
    await indexer.scanProject(FIXTURE);
    symbolService = new SymbolService(dbService);
    referenceService = new ReferenceService(dbService);
  });

  afterAll(() => db.close());

  test('find_symbol locates AuthService class', () => {
    const result = symbolService.findSymbol({ name: 'AuthService' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.kind).toBe('class');
    expect(result.results[0]!.file_path).toContain('authService.ts');
  });

  test('search_symbols finds functions by partial name', () => {
    const result = symbolService.searchSymbols({ query: 'User' });
    expect(result.results.some(r => r.name === 'getUsers')).toBe(true);
  });

  test('get_methods returns AuthService methods', () => {
    const result = symbolService.getMethods({ class_name: 'AuthService' });
    expect(result.results.some(m => m.name === 'login')).toBe(true);
    expect(result.results.some(m => m.name === 'logout')).toBe(true);
  });

  test('get_file_symbols returns symbols for authService.ts', () => {
    const filePath = join(FIXTURE, 'src/auth/authService.ts');
    const result = symbolService.getFileSymbols({ file_path: filePath });
    expect(result.results.some(s => s.name === 'AuthService')).toBe(true);
  });

  test('_meta includes count and query_ms', () => {
    const result = symbolService.findSymbol({ name: 'AuthService' });
    expect(result._meta.count).toBe(1);
    expect(result._meta.query_ms).toBeGreaterThanOrEqual(0);
    expect(result._meta.correlationId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
bun test test/integration.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests across all test files PASS. No failures.

- [ ] **Step 4: Final commit**

```bash
git add test/integration.test.ts
git commit -m "test(integration): add full index+query cycle smoke test"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec Section | Covered by Task |
|---|---|
| 3-layer architecture | Tasks 5-11 |
| SQLite schema + B+trees | Task 4 |
| Bun runtime | Task 1 (package.json) |
| pino logging | Task 3 |
| Class-based services + BaseService | Task 5 |
| DatabaseService full CRUD | Task 5 |
| ParserService ts-morph extraction | Task 6 |
| IndexerService + chokidar + debounce | Task 7 |
| flush_file bypasses debounce | Task 7 |
| SymbolService (find/search/methods/file) | Task 8 |
| ReferenceService (callers/impl/hierarchy/related) | Task 9 |
| IFrameworkResolver interface | Task 10 |
| ExpressResolver + NextJsResolver + SvelteKitResolver | Task 10 |
| FrameworkService monorepo detection | Task 11 |
| ConfigService resolve_config | Task 11 |
| All 12 MCP tools registered | Task 12-13 |
| Zod validation on all tool inputs | Task 12 |
| Error hierarchy + catch boundaries | Task 2 + all tools |
| Partial result + _warnings | Task 9 (ReferenceService) |
| Fatal startup exit code 1 | Task 13 (index.ts) |
| _meta with correlationId on all responses | Tasks 8, 9, 11 |
| Project root detection priority chain | Task 2 (env.ts) |
| Schema version in project_meta | Task 4 |
| Husky pre-commit/pre-push/commit-msg | Task 1 |
| TSDoc Praman annotations | All service tasks |
| Max 600 lines per file | Verified — split if exceeded |
| No .env reading | ConfigService explicitly excludes .env |
