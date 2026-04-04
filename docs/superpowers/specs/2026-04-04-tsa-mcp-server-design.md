# TSA MCP Server — Design Spec

**Date:** 2026-04-04  
**Status:** Approved for implementation  
**Runtime:** Bun  
**Transport:** Stdio (supports Claude Code, Cursor, Codex CLI)

---

## 1. Overview

TSA (TypeScript AST) is an MCP server that gives AI coding agents semantic understanding of a TypeScript codebase through structural queries rather than text search. It maintains a persistent, incrementally-updated SQLite index of every symbol, call graph edge, and file relationship in the project.

**Problem it solves:** AI agents waste 1,800–5,000 tokens reading wrong files when navigating unfamiliar codebases via Grep/Glob. TSA eliminates wrong-file reads by answering structural questions ("who calls redirectToLogin?") from an indexed B+tree lookup in microseconds.

**Scope:** All three layers from the spec — Layer 1 (indexer), Layer 2 (structural queries), Layer 3 (runtime context). Framework support for Express, Next.js (Pages + App Router), SvelteKit.

---

## 2. Folder Structure

```
tsa-mcp-server/
  src/
    index.ts                          # Entry point — starts server
    server.ts                         # MCP server init, tool registration
    types/
      common.ts                       # SymbolKind, RefKind, HttpMethod, shared interfaces
      env.ts                          # ENV interface + validateEnv()
    logging/
      logger.ts                       # Winston instance (console dev, file prod)
      logQueue.ts                     # LogQueue class — buffered async dispatch
      logEvents.ts                    # LogEvents enum — all event name constants
    errors/
      TsaError.ts                     # Base error class with code + context
      IndexError.ts                   # File parsing failures
      QueryError.ts                   # SQLite query failures
      FrameworkError.ts               # Framework detection/tracing failures
      ValidationError.ts              # Zod schema validation failures
    database/
      schema.ts                       # SQLite DDL — CREATE TABLE + CREATE INDEX
      client.ts                       # bun:sqlite Database singleton
      migrations/
        0001_initial.sql              # symbols, references, files, project_meta
      types.ts                        # SymbolRow, ReferenceRow, FileRow raw types
    services/
      BaseService.ts                  # Abstract — logInfo/logError/logWarn/logDebug
      DatabaseService.ts              # All bun:sqlite reads/writes, schema init
      ParserService.ts                # ts-morph AST extraction, symbol + ref extraction
      IndexerService.ts               # chokidar watcher, orchestrates parse→store
      SymbolService.ts                # find_symbol, search_symbols, get_methods, get_file_symbols
      ReferenceService.ts             # get_callers, get_implementations, get_hierarchy, get_related_files
      FrameworkService.ts             # Framework detection, delegates to resolvers
      ConfigService.ts                # resolve_config for vite.config.ts, drizzle.config.ts, etc.
    tools/
      symbol-tools.ts                 # Registers Layer 2 symbol tools
      reference-tools.ts              # Registers Layer 2 reference tools
      runtime-tools.ts                # Registers Layer 3 tools
      index-tools.ts                  # Registers flush_file
    framework/
      resolver-interface.ts           # IFrameworkResolver interface
      express-resolver.ts             # app.use() / router.get() AST traversal
      nextjs-resolver.ts              # Pages Router + App Router file convention mapping
      sveltekit-resolver.ts           # +server.ts + hooks.server.ts walking
  test/
    fixtures/
      simple-ts-project/              # 1 class, 2 methods — baseline indexer tests
      express-project/                # Express app for FrameworkService tests
      nextjs-project/                 # Next.js Pages + App Router fixtures
      sveltekit-project/              # SvelteKit routes + hooks fixtures
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
    pre-commit                        # gitleaks + duplicate check
    pre-push                          # bun test + lint
    commit-msg                        # conventional commits enforcement
    check-duplicates.sh
  package.json
  tsconfig.json
  CHANGELOG.md
```

---

## 3. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "ts-morph": "latest",
    "chokidar": "latest",
    "pino": "latest",
    "pino-pretty": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "husky": "latest",
    "@types/node": "latest"
  }
}
```

**Notes:**
- `bun:sqlite` is built into Bun — no `better-sqlite3` needed.
- `pino` replaces Winston — Winston uses Node.js streams internally which cause compatibility issues on Bun. Pino has first-class Bun support and is significantly faster. `pino-pretty` for dev console output.

---

## 4. Database Schema

```sql
-- 0001_initial.sql

CREATE TABLE symbols (
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

CREATE INDEX idx_symbols_name       ON symbols(name);
CREATE INDEX idx_symbols_file       ON symbols(file_path);
CREATE INDEX idx_symbols_kind       ON symbols(kind);
CREATE INDEX idx_symbols_parent     ON symbols(parent_id);
CREATE INDEX idx_symbols_name_kind  ON symbols(name, kind);
CREATE INDEX idx_symbols_file_kind  ON symbols(file_path, kind);

CREATE TABLE references (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  ref_kind         TEXT NOT NULL CHECK(ref_kind IN (
    'calls','imports','extends','implements','type_ref','decorator'
  )),
  source_line      INTEGER,
  confidence       TEXT DEFAULT 'direct' CHECK(confidence IN ('direct','inferred','weak'))
);

CREATE INDEX idx_refs_source      ON references(source_symbol_id);
CREATE INDEX idx_refs_target      ON references(target_symbol_id);
CREATE INDEX idx_refs_kind        ON references(ref_kind);
CREATE INDEX idx_refs_target_kind ON references(target_symbol_id, ref_kind);

CREATE TABLE files (
  path          TEXT PRIMARY KEY,
  last_modified INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  symbol_count  INTEGER DEFAULT 0,
  index_time_ms INTEGER DEFAULT 0
);

CREATE TABLE project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Seed schema version — used by DatabaseService to determine which migrations to run
INSERT INTO project_meta (key, value) VALUES ('schema_version', '1');
```

---

## 5. Data Flow

### Project root detection (priority order)
```
1. --project <path> CLI argument
2. TSA_PROJECT_ROOT environment variable
3. Nearest tsconfig.json walking up from CWD
4. CWD as last resort
```
`TSA_DB_PATH` defaults to `<rootPath>/.tsa/index.db` if not set.

### Startup sequence
```
index.ts
  → detectProjectRoot()              # priority chain above
  → validateEnv()                    # requires resolvable rootPath
  → DatabaseService.initialize()     # run pending migrations (check schema_version)
  → IndexerService.start(rootPath)   # full scan, skip unchanged files (hash check)
  → server.ts registerTools()        # all 12 MCP tools registered
  → StdioServerTransport.connect()   # ready for MCP calls
```

### File change flow (chokidar-driven, debounced)
```
chokidar detects add/change/unlink
  → IndexerService.scheduleReindex(filePath)   # debounce 300ms — editors fire 2-3 events per save
  → [300ms passes with no further events]
  → IndexerService.reindexFile(filePath)
  → DatabaseService.deleteFileSymbols(filePath)
  → ParserService.parseFile(filePath)
  → DatabaseService.insertSymbols(symbols)
  → ParserService.extractReferences(filePath)
  → DatabaseService.insertReferences(refs)
  → DatabaseService.updateFileRecord(filePath)
```

### flush_file flow (agent-driven, synchronous — bypasses debounce)
```
Agent writes a file, then immediately queries the index
  → Agent calls flush_file({ file_path: "src/auth/authService.ts" })
  → index-tools.ts: Zod validates input
  → IndexerService.flushFile(filePath)         # cancels any pending debounce for this file
  → reindexFile(filePath) runs synchronously   # same steps as above, no delay
  → returns { success: true, symbols_indexed: 12, time_ms: 48 }
  → Agent can now safely query updated symbols
```
This is the critical path — Claude Code edits a file and queries the index before chokidar fires. flush_file guarantees consistency.

### MCP tool call flow
```
Agent calls find_symbol({ name: "handleLogin" })
  → symbol-tools.ts: Zod validates input
  → SymbolService.findSymbol({ name, kind? })
  → DatabaseService.querySymbols(sql, params)
  → format compact JSON response
  → return to agent (~80-120 tokens)
```

### Framework detection flow (monorepo-aware)
```
FrameworkService.detectFrameworks(rootPath)
  → scans rootPath and direct subdirs for framework config files
  → builds resolver map: PathPrefix → IFrameworkResolver

  Examples detected:
    "packages/api"      → express in package.json  → ExpressResolver
    "packages/web"      → next.config.ts exists     → NextJsResolver
    "packages/landing"  → svelte.config.ts exists   → SvelteKitResolver

  Single-repo example:
    "."                 → next.config.ts exists     → NextJsResolver

  → resolver map cached for session

trace_middleware({ route_path: "/api/users" })
  → FrameworkService.resolverFor("/api/users")     # matches longest prefix in map
  → resolver.traceMiddleware("/api/users")
  → compact JSON response
```

---

## 6. Service Responsibilities

| Service | Owns | Does NOT own |
|---|---|---|
| `DatabaseService` | All SQLite reads/writes, schema init, migrations | Parsing, business logic |
| `ParserService` | ts-morph AST extraction, symbol + reference extraction | Storage, file watching |
| `IndexerService` | chokidar watcher, orchestrates parse→store, full scan on startup | Parsing internals, DB queries |
| `SymbolService` | find_symbol, search_symbols, get_methods, get_file_symbols | References, frameworks |
| `ReferenceService` | get_callers, get_implementations, get_hierarchy, get_related_files | Symbol queries, frameworks |
| `FrameworkService` | Monorepo-aware framework detection, builds prefix→resolver map, trace_middleware, get_route_config | AST parsing, DB ops |
| `ConfigService` | resolve_config — reads and parses non-env config files (vite.config.ts, drizzle.config.ts, tsconfig.json) via ts-morph, returns resolved key values | Framework routing, .env files |

### Framework resolvers

Implement `IFrameworkResolver`, instantiated and cached by `FrameworkService`:

```typescript
interface IFrameworkResolver {
  traceMiddleware(routePath: string, method?: string): MiddlewareTrace[];
  getRouteConfig(urlPath: string): RouteConfig;
}
```

| Resolver | Strategy |
|---|---|
| `ExpressResolver` | Parses `app.use()` / `router.get()` call chains via ts-morph AST |
| `NextJsResolver` | Maps URL → file by convention for both Pages and App Router |
| `SvelteKitResolver` | Maps URL → `+server.ts`, walks up directory tree for `hooks.server.ts` |

---

## 7. MCP Tools

### Layer 2 — Symbol tools

| Tool | Zod Input | Delegates to |
|---|---|---|
| `find_symbol` | `{ name: string, kind?: SymbolKind }` | `SymbolService.findSymbol()` |
| `search_symbols` | `{ query: string, kind?: SymbolKind, limit?: number }` | `SymbolService.searchSymbols()` |
| `get_methods` | `{ class_name: string }` | `SymbolService.getMethods()` |
| `get_file_symbols` | `{ file_path: string, kind?: SymbolKind }` | `SymbolService.getFileSymbols()` |

### Layer 2 — Reference tools

| Tool | Zod Input | Delegates to |
|---|---|---|
| `get_callers` | `{ symbol_name: string, class_name?: string }` | `ReferenceService.getCallers()` |
| `get_implementations` | `{ interface_name: string }` | `ReferenceService.getImplementations()` |
| `get_hierarchy` | `{ class_name: string }` | `ReferenceService.getHierarchy()` |
| `get_related_files` | `{ file_path: string }` | `ReferenceService.getRelatedFiles()` |

### Layer 2 — Index tools

| Tool | Zod Input | Delegates to |
|---|---|---|
| `flush_file` | `{ file_path: string }` | `IndexerService.flushFile()` |

### Layer 3 — Runtime tools

| Tool | Zod Input | Delegates to |
|---|---|---|
| `trace_middleware` | `{ route_path: string, method?: HttpMethod }` | `FrameworkService.traceMiddleware()` |
| `get_route_config` | `{ url_path: string }` | `FrameworkService.getRouteConfig()` |
| `resolve_config` | `{ config_key: string }` | `ConfigService.resolveConfig()` |

**`resolve_config` example:**
```
Input:  { config_key: "build.outDir" }
Scans:  vite.config.ts → finds build: { outDir: "dist" }

Output:
{
  final_value: "dist",
  chain: [
    { source: "vite.config.ts:8", value: "dist" }
  ]
}
```
ConfigService uses ts-morph to statically read the config file AST and extract the value at the given key path. It does NOT execute the config file. It does NOT read `.env` files — those are out of scope.

### Response format

All tools return compact JSON with `_meta`. Never include source code in responses.

**Success:**
```typescript
{
  results: [...],
  _meta: { count: number, query_ms: number, correlationId: string }
}
```

**Partial success (some refs point to deleted files):**
```typescript
{
  results: [...valid results],
  _warnings: ["Reference to deleted file src/old/auth.ts skipped"],
  _meta: { count: number, query_ms: number }
}
```

**Error:**
```typescript
{
  success: false,
  error: {
    code: "INDEX_ERROR",
    message: "Failed to parse src/auth/authService.ts",
    context: { file_path: "...", reason: "..." }
  },
  _meta: { query_ms: number }
}
```

---

## 8. Error Handling

### Error hierarchy
```
TsaError (base: code, message, context)
  ├── IndexError       # ts-morph parse failure
  ├── QueryError       # bun:sqlite failure
  ├── FrameworkError   # framework detection/tracing failure
  └── ValidationError  # Zod input validation failure
```

### Catch boundaries

- **Tool files** — catch all errors from service calls, log via LogQueue, return structured error response. Never throw to MCP SDK.
- **Service layer** — catch DB/parser exceptions, wrap in TsaError subclass with context, rethrow.
- **DatabaseService** — wraps `bun:sqlite` exceptions in `QueryError` with query + file_path.
- **ParserService** — wraps ts-morph exceptions in `IndexError` with file_path + line.

### Fatal startup errors

If `DatabaseService.initialize()` or `IndexerService.start()` fails — log at `FATAL` level, exit code `1`. Never start the MCP server in a broken state.

### Partial failure rule

Return valid results + `_warnings` array rather than failing the entire call when some references point to stale/deleted data.

---

## 9. Logging

Follows coding standards, adapted for Bun + pino:

- All logs go through `LogQueue` — never synchronous in tool call path
- **pino** as logger (replaces Winston) — first-class Bun support, faster, same structured output
- Transports: `pino-pretty` to stderr (dev), file transport `app.log` + `error.log` (prod), controlled by `NODE_ENV`
- Every log entry: `timestamp`, `level`, `message`, `service` (class name), `correlationId`, context
- `correlationId` — UUID generated per tool invocation in the tool wrapper, passed down through service calls, included in `_meta` on every response for traceability
- `LogEvents` enum for all event names — no ad-hoc strings
- All services extend `BaseService` for `logInfo`, `logError`, `logWarn`, `logDebug` helpers

---

## 10. Testing

- Runner: `bun:test`
- Test files live in `test/services/` alongside service names
- Each service test uses **in-memory SQLite** (`new Database(":memory:")`) — no file state between tests
- Fixture projects in `test/fixtures/` provide real TS files for parser/indexer tests
- Tests not generated unless explicitly requested during implementation

---

## 11. Git & Security

- Husky pre-commit: `gitleaks protect --staged` + duplicate class/function check
- Husky pre-push: `bun test` + `bun run lint`
- Husky commit-msg: conventional commits format enforced
- `.env` never committed — `.env.example` always committed
- ENV validated on startup via `validateEnv()` in `src/types/env.ts`

---

## 12. Coding Standards Applied

- Max 600 lines per file — split into sub-classes if exceeded
- 100% TypeScript, no implicit `any`, all functions have explicit return types
- All services class-based, extending `BaseService`
- TSDoc Praman annotations (`@param`, `@returns`, `@throws`, `@example`) on all classes and methods
- `tools/` files: thin wrappers only — Zod validation + service delegation, zero business logic
- `index.ts` files: re-exports only, zero logic

---

## 13. Call Graph Limitations

Static call graph from ts-morph is best-effort. Known failure modes:

- Dependency injection (`@Inject` providers)
- Event emitters (string-based event names)
- Dynamic dispatch (`obj[methodName]()`)
- Callbacks and higher-order functions
- Re-exports and barrel files

Handled via `confidence` field: `'direct' | 'inferred' | 'weak'`. Disclaimer included in `get_callers` responses.
