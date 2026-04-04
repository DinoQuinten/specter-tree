# TSA: TypeScript AST MCP Server

> Codebase intelligence through structural queries, not text search.

## What this document is

This is a complete specification and implementation guide for an open-source MCP server that gives AI coding agents (Claude Code, Cursor, etc.) semantic understanding of a codebase. It was developed through an iterative design session that stress-tested every assumption against how Claude Code actually works today (Grep, Glob, Read tools). The numbers in this document are realistic, not marketing.

This document is designed to be handed directly to Claude Code as a prompt. It contains everything needed to build the MVP.

---

## 1. Problem statement

When an AI coding agent encounters a new codebase and a user says "auth is not working, I'm being redirected to login page," the agent must figure out WHERE the auth code lives before it can fix anything.

Today, Claude Code does this:

```
Grep "redirect" "login"        -> 12 text matches across routes, tests, mocks, middleware
Glob **/*auth*                  -> 8 files with "auth" in the name
Read auth.routes.ts             -> 900 tokens (wrong file)
Read auth.interceptor.ts        -> 900 tokens (wrong file)
Read auth.middleware.ts          -> 1,200 tokens (right file)
Read auth-service.ts            -> 4,000 tokens (needed for context)
Edit auth.middleware.ts          -> 200 tokens
```

Total: ~7,200+ tokens, of which ~1,800 were wasted on wrong files.

The root problem: **Grep finds text matches, not structural relationships.** It cannot answer "who calls redirectToLogin()?" or "which classes implement IAuthProvider?" without the agent reading multiple files and reasoning through them.

### What TSA does differently

TSA maintains a persistent, incrementally-updated index of every symbol (class, function, method, interface, type, enum) in the codebase, stored in SQLite with B+tree indexes. When the agent asks "who calls redirectToLogin?", the answer comes from an index lookup in microseconds, not from reading 5 files.

```
MCP: search_symbols("redirect", "login")  -> NavigationService.postLoginRedirect at navigation.service.ts:42
MCP: get_callers("postLoginRedirect")      -> called from AuthService.login:145, LoginComponent.onSubmit:32
Read navigation.service.ts                 -> 1,400 tokens (the right file, first try)
Edit navigation.service.ts                 -> 200 tokens
```

Total: ~1,900 tokens. Zero wrong files.

---

## 2. Realistic savings (stress-tested)

These numbers were validated against Claude Code's actual tool behavior (Grep returns ~100-300 tokens, Glob returns ~60 tokens, Read returns full file contents).

### Cost decomposition model

```
Total Token Cost =
  Navigation Cost          (Grep/MCP queries to find relevant code)
+ File Read Cost           (reading files the agent actually needs)
+ Wrong Read Cost          (reading files that turn out to be irrelevant)
+ Backtrack Cost           (re-reading files due to wrong initial mental model)
+ Runtime Investigation    (understanding config, env, runtime state)
```

### Where TSA helps and where it does not

| Cost component | TSA impact | Why |
|---|---|---|
| Navigation | Slightly worse | MCP queries cost ~80-200 tokens each vs Grep at ~100-300. Multi-hop structural queries add up. |
| File reads | No change | Agent must still Read the file it needs to edit. TSA cannot compress a 4,000-token file. |
| Wrong reads | Much lower | Call graph eliminates guessing. Reduces wrong reads from 2-5 to 0-1. |
| Backtracking | Lower | Agent reads the causal origin first instead of plausible-sounding files. Better decision quality. |
| Runtime investigation | No change (without Layer 3) | Static AST cannot tell you what .env values are set to. |

### Realistic multipliers by scenario

| Scenario | Grep baseline | TSA (L1+L2) | TSA (L1+L2+L3) |
|---|---|---|---|
| Single-point bug (1 file) | 6-15K tokens | 4-9K (2-3x better) | 3-7K |
| Multi-file flow bug (3-5 files) | 11-25K tokens | 7-15K (1.3-1.8x) | 3-8K |
| Config/env bug | 8-20K tokens | 7-18K (~1.0x, no gain) | 1-3K (big gain) |
| Runtime state bug | 10-30K tokens | 9-25K (~1.0x) | 5-15K |

Key insight: Layer 2 (structural queries) alone gives 1.3-1.8x savings on multi-file bugs. Layer 3 (runtime context) is what breaks past the plateau into 2-5x for config/env bugs. Without Layer 3, you have built a slightly smarter Grep.

The primary benefit is precision of entry point, not raw token compression.

---

## 3. Competitive landscape

Several projects already exist in this space. Understanding them is critical for positioning.

| Project | Language | AST parser | Storage | Strengths | Gaps |
|---|---|---|---|---|---|
| code-graph-mcp | Python | ast-grep | In-memory (rustworkx) | 25+ languages, PageRank analysis, LRU caching | No persistent storage, Python runtime required, no runtime context layer |
| contextplus | TypeScript | tree-sitter | In-memory property graph + disk cache | Semantic embeddings (Ollama), spectral clustering, wikilink graph | Requires GPU/Ollama for embeddings, complex setup, heavy |
| jCodeMunch-MCP | Python | tree-sitter | File-based index | Token savings tracking, O(1) byte-offset seeking | Python runtime, no call graph, no SQLite persistence |
| CodePrism | Rust | Custom per-language | Graph store | Native performance, 20+ tools, WASM plugin system | Rust compilation required, complex architecture, early stage |
| ast-grep-mcp | Python | ast-grep | None (live queries) | Pattern matching, rule-based search | No persistent index, no call graph, no symbol storage |
| mcp-language-server | TypeScript | LSP delegation | None (proxies to LSP) | Uses existing LSP servers, get-definition/references | Requires running LSP server, no persistent index |

### TSA positioning

TSA differentiates on:

1. **Persistent B+tree storage** (SQLite) -- survives restarts, instant startup on re-entry
2. **Language-centric, not framework-centric** -- TypeScript first, extensible to other languages via parser plugins
3. **Three-layer architecture** -- most competitors only have Layer 1+2. Layer 3 (runtime context) is novel.
4. **Minimal dependencies** -- no GPU, no Docker, no external database. Just Node.js + SQLite.
5. **Open source from day one** -- designed for community contribution of language parsers

---

## 4. Architecture

### Three layers

```
Layer 1: Offline Indexer          (0 tokens, runs locally)
  |-- File watcher (chokidar)
  |-- AST parser (ts-morph for TypeScript, tree-sitter for future languages)
  |-- Symbol extractor
  |-- Call graph builder (best-effort)
  +-- SQLite storage with B+tree indexes

Layer 2: Structure Query Tools    (~80-200 tokens per MCP call)
  |-- find_symbol
  |-- get_methods
  |-- get_callers
  |-- get_implementations
  |-- search_symbols
  |-- get_hierarchy
  |-- get_file_symbols
  |-- get_related_files
  +-- flush_file

Layer 3: Runtime Context Tools    (~100-500 tokens per MCP call)
  |-- read_env
  |-- resolve_config
  |-- trace_middleware (language/framework-specific)
  +-- get_route_config (language/framework-specific)
```

---

## 5. Data structures: why B+trees and how they work here

### SQLite uses B+trees internally

This is not a choice we make. It is how SQLite works. When you write `CREATE INDEX idx_name ON symbols(name)`, SQLite builds a B+tree where:

- **Leaf nodes** store the actual (name, rowid) pairs, sorted alphabetically
- **Interior nodes** store routing keys that direct searches to the correct leaf page
- **All data lives in leaf nodes** (this is the B+ part -- unlike plain B-trees where data can live in interior nodes too)
- **Leaf nodes are linked** via pointers, allowing efficient range scans (e.g., "all symbols starting with Auth")
- **Each page is 4KB** aligned to filesystem block size for optimal disk I/O

SQLite uses TWO types of B-trees internally:
1. **Table B-trees** (B+trees): store table rows, keyed by rowid. Data only in leaf nodes.
2. **Index B-trees**: store (indexed_columns, rowid) pairs. No payload in internal nodes.

Every `CREATE INDEX` builds a separate B+tree on disk. Every table with a rowid (which is every table unless you use WITHOUT ROWID) has its own B+tree.

### Performance at our scale

For a codebase with ~5,000 symbols:
- B+tree depth: 3-4 levels
- Pages per lookup: 3-4 pages at 4KB each = ~12-16KB disk I/O
- Time per lookup: ~10-20 microseconds (from disk), sub-microsecond (from OS page cache)
- The entire SQLite file for 5,000 symbols fits in ~2-4MB

For comparison, reading a single TypeScript file via Claude Code's Read tool takes ~100ms and costs ~800-4,000 tokens. The B+tree lookup is 10,000x faster and costs 0 tokens.

### Why B+trees and not other structures

| Structure | Point lookup | Range scan | Prefix search | Our verdict |
|---|---|---|---|---|
| B+tree (SQLite) | O(log n) | O(log n + k) | O(log n + k) | Best all-around. Handles all our query patterns. |
| Hash index | O(1) | Not possible | Not possible | Cannot do LIKE queries or range scans. |
| Trie (prefix tree) | O(key length) | O(prefix + k) | O(prefix + k) | Good for autocomplete but adds implementation complexity. SQLite LIKE on B+tree is fast enough. |
| Skip list | O(log n) | O(log n + k) | O(log n + k) | Similar to B+tree but no SQLite support. Would mean custom implementation. |
| LSM tree | O(log n) amortized | O(n) worst case | O(log n + k) | Optimized for write-heavy workloads. Our reads vastly outnumber writes. |

Decision: Use SQLite B+trees via standard CREATE INDEX. No custom data structures needed.

### Graph storage: adjacency list with recursive CTE

The call graph is a directed graph (function A calls function B). Four common SQL strategies:

| Strategy | Read | Write | Storage | Best for |
|---|---|---|---|---|
| Adjacency list | O(log n) per hop | O(1) insert | O(edges) | Shallow graphs with frequent updates (our case) |
| Closure table | O(1) any depth | O(n) insert | O(n^2) worst | Read-heavy deep hierarchies |
| Nested sets | O(1) subtree | O(n) insert | O(nodes) | Rarely-changed trees |
| Materialized path | O(1) ancestors | O(1) insert | O(nodes * depth) | Deep trees with infrequent updates |

**Decision: Adjacency list.**

Reasoning:
- Call graph changes on every file save (high write frequency)
- Queries are typically 1-2 hops ("who calls this?" / "what does this call?")
- SQLite recursive CTEs handle the rare multi-hop queries
- Closure table storage would be O(n^2) for large codebases -- unacceptable
- Rebuild cost on file change: DELETE refs for file, INSERT new refs. Simple, fast.

Recursive CTE for multi-hop traversal when needed:

```sql
WITH RECURSIVE call_chain(id, name, file_path, depth) AS (
  SELECT id, name, file_path, 0
  FROM symbols WHERE name = 'handleLogin'
  UNION ALL
  SELECT s.id, s.name, s.file_path, cc.depth + 1
  FROM references r
  JOIN symbols s ON s.id = r.target_symbol_id
  JOIN call_chain cc ON cc.id = r.source_symbol_id
  WHERE cc.depth < 10
)
SELECT DISTINCT name, file_path, depth FROM call_chain ORDER BY depth;
```

### Symbol hierarchy: parent_id self-reference

Class > method > parameter hierarchy is a shallow tree (max 3 levels). Stored as `parent_id` foreign key on the symbols table. `WHERE parent_id = ?` with B+tree index covers the common case ("get all methods of this class") in O(log n).

No need for closure tables or nested sets for this hierarchy -- it is too shallow to benefit from them.

### Schema

```sql
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

-- Each CREATE INDEX builds a separate B+tree in SQLite
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_parent ON symbols(parent_id);
CREATE INDEX idx_symbols_name_kind ON symbols(name, kind);
CREATE INDEX idx_symbols_file_kind ON symbols(file_path, kind);

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

CREATE INDEX idx_refs_source ON references(source_symbol_id);
CREATE INDEX idx_refs_target ON references(target_symbol_id);
CREATE INDEX idx_refs_kind ON references(ref_kind);
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
```

### Index justification

Every index costs write performance (SQLite updates the B+tree on every INSERT/UPDATE/DELETE). Only add indexes that a specific tool needs:

| Index | Tool | Query |
|---|---|---|
| idx_symbols_name | find_symbol, search_symbols | WHERE name = ? / WHERE name LIKE ? |
| idx_symbols_file | get_file_symbols, flush_file | WHERE file_path = ? |
| idx_symbols_kind | search_symbols (filtered) | WHERE kind = 'class' |
| idx_symbols_parent | get_methods | WHERE parent_id = ? |
| idx_symbols_name_kind | find_symbol (filtered) | WHERE name = ? AND kind = 'class' |
| idx_symbols_file_kind | get_file_symbols (filtered) | WHERE file_path = ? AND kind IN (...) |
| idx_refs_target | get_callers | WHERE target_symbol_id = ? |
| idx_refs_target_kind | get_implementations | WHERE target_symbol_id = ? AND ref_kind = 'implements' |

Do not add indexes speculatively.

---

## 6. Call graph limitations (be honest)

The static call graph from ts-morph is best-effort. It breaks with:

- Dependency injection (Angular/NestJS @Inject providers)
- Event emitters (string-based event names)
- Dynamic dispatch (obj[methodName]())
- Callbacks and higher-order functions
- Middleware stacking (runtime ordering)
- Re-exports and barrel files

Handle this by:
1. Including a `confidence` field: 'direct', 'inferred', 'weak'
2. Adding a disclaimer in get_callers responses
3. Never claiming completeness

A 70% accurate call graph is still more useful than Grep returning 12 false-positive text matches.

---

## 7. SDK: TypeScript MCP SDK

Use `@modelcontextprotocol/sdk` (TypeScript). Full stack in one language:

- AST parser: ts-morph (TypeScript)
- Storage: better-sqlite3 (synchronous, fast)
- File watcher: chokidar
- MCP server: @modelcontextprotocol/sdk
- Schema validation: zod (required peer dep of MCP SDK)
- Transport: StdioServerTransport (Claude Code spawns as child process)

### Why not Python: ts-morph is TypeScript, users have Node.js, no virtualenv needed
### Why not Rust: bottleneck is parsing (~50ms/file), not queries (~0.01ms). Rust adds contributor friction for no gain at our scale.

---

## 8. MCP tool specifications

### Layer 2: Structure queries

Each tool returns compact JSON. Never include source code in responses.

**find_symbol** { name, kind? } -> [{ name, kind, file_path, line, signature, modifiers }] ~80-120 tok
**get_methods** { class_name } -> [{ name, signature, modifiers, line, return_type }] ~100-200 tok
**get_callers** { symbol_name, class_name? } -> [{ caller_name, caller_class, caller_file, line, confidence }] ~60-150 tok
**get_implementations** { interface_name } -> [{ class_name, file_path, line }] ~60-100 tok
**search_symbols** { query, kind?, limit? } -> [{ name, kind, file_path, line, signature }] ~100-250 tok
**get_hierarchy** { class_name } -> { extends, implements, extended_by, implemented_by } ~80-150 tok
**get_file_symbols** { file_path, kind? } -> [{ name, kind, signature, line }] ~100-300 tok
**get_related_files** { file_path } -> { imports_from, imported_by } ~60-100 tok
**flush_file** { file_path } -> { success, symbols_indexed, time_ms } 0 tok

### Layer 3: Runtime context

**read_env** { key?, pattern? } -> [{ key, value, source_file }] ~100-200 tok
**resolve_config** { config_key } -> { final_value, chain: [{ source, value }] } ~200-400 tok
**trace_middleware** { route_path, method? } -> [{ name, file_path, line, order }] ~150-300 tok (framework-specific)
**get_route_config** { url_path } -> { handler, file_path, guards, redirects } ~200-400 tok (framework-specific)

---

## 9. Implementation phases

### Phase 1: MVP
Indexer + basic queries (find_symbol, get_methods, get_file_symbols, search_symbols, flush_file). No call graph.

### Phase 2: Call graph
References table, get_callers, get_implementations, get_hierarchy, get_related_files. Confidence scoring.

### Phase 3: Runtime context
read_env, resolve_config. Framework detection. trace_middleware for Express (stretch).

### Phase 4: Multi-language
LanguageParser interface. tree-sitter JavaScript/Python parsers. Community contribution path.

### Phase 5: Publish
npm package, GitHub repo, contributing guide, integration examples.

---

## 10. File structure

```
tsa-mcp-server/
  src/
    index.ts
    server.ts
    indexer/
      parser.ts
      watcher.ts
      db.ts
      references.ts
      hasher.ts
    tools/
      find-symbol.ts
      get-methods.ts
      get-callers.ts
      get-implementations.ts
      get-file-symbols.ts
      search-symbols.ts
      get-hierarchy.ts
      get-related-files.ts
      flush-file.ts
    runtime/
      env-reader.ts
      config-resolver.ts
      middleware-tracer.ts
      route-resolver.ts
    parsers/
      parser-interface.ts
      typescript-parser.ts
    utils/
      framework-detect.ts
      response-format.ts
  test/
    fixtures/
    indexer.test.ts
    tools.test.ts
    references.test.ts
  package.json
  tsconfig.json
  README.md
  LICENSE
  CONTRIBUTING.md
```

---

## 11. Design principles

1. **Tokens are the currency.** Every byte in an MCP response enters the agent's context window. Return minimum data.
2. **Persist everything.** SQLite file survives restarts. No re-scanning on next session.
3. **Incremental over full rebuild.** Re-index only changed files (~50ms each).
4. **Honest about limitations.** Call graph is best-effort. Communicate confidence levels.
5. **Language-centric, not framework-centric.** Core tools work for any TypeScript project. Layer 3 can be framework-specific.
6. **Minimal dependencies.** No Docker, no GPU, no cloud. Just npm install.
7. **Open for contribution.** LanguageParser interface is the extension point for new languages.
