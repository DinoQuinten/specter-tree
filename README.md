# TSA MCP Server

> **TypeScript Symbol Analysis** — codebase intelligence for AI coding assistants via the Model Context Protocol.

Instead of asking your AI to grep through files, TSA gives it a structural index of your TypeScript codebase. Find symbols, trace call graphs, resolve references — in a single query, without reading files.

---

## How it works

```
Your TypeScript project
        │
        ▼
  [chokidar watcher]  ◄── file saved
        │
        ▼
  [ts-morph parser]   — extracts symbols, signatures, references
        │
        ▼
  [SQLite index]      — stores everything, content-hashed
        │
        ▼
  [MCP server]        ◄── Claude / any MCP client queries here
```

On startup, TSA scans your project and builds a SQLite index. From that point on, chokidar watches for file changes and re-indexes within 300ms. Your AI always queries a live, up-to-date snapshot.

---

## Quick start

**Prerequisites:** [Bun](https://bun.sh)

```bash
git clone https://github.com/your-username/tsa-mcp-server
cd tsa-mcp-server
bun install
```

Add to your `.mcp.json` (Claude Code) or MCP client config:

```json
{
  "mcpServers": {
    "tsa": {
      "command": "bun",
      "args": ["run", "/path/to/tsa-mcp-server/src/index.ts"],
      "env": {
        "TSA_PROJECT_ROOT": "/path/to/your/typescript/project"
      }
    }
  }
}
```

That's it. TSA will scan your project on first run and stay live from there.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TSA_PROJECT_ROOT` | No | Auto-detected | Root of the TypeScript project to index |
| `TSA_DB_PATH` | No | `{root}/.tsa/index.db` | Where to store the SQLite index |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | No | `development` | `development` / `production` |

**Project root auto-detection order:**
1. `--project <path>` CLI argument
2. `TSA_PROJECT_ROOT` env var
3. Nearest `tsconfig.json` walking up from `cwd`
4. `cwd` as last resort

---

## Tools

### Symbol navigation

<details>
<summary><strong>find_symbol</strong> — find by exact name</summary>

Returns file path, line number, kind, and full signature.

```json
{
  "name": "startServer",
  "kind": "function"
}
```

```json
{
  "results": [{
    "name": "startServer",
    "kind": "function",
    "file_path": "/project/src/server.ts",
    "line": 111,
    "signature": "export async function startServer(services: ServiceContainer): Promise<void>"
  }]
}
```

`kind` filter options: `class` `interface` `enum` `type_alias` `function` `method` `property` `constructor` `getter` `setter` `enum_member` `variable`

</details>

<details>
<summary><strong>search_symbols</strong> — fuzzy search by partial name</summary>

LIKE-matching across all indexed symbols.

```json
{
  "query": "Service",
  "kind": "class",
  "limit": 10
}
```

</details>

<details>
<summary><strong>get_file_symbols</strong> — all symbols in a file</summary>

```json
{
  "file_path": "/project/src/server.ts"
}
```

Returns every symbol declared in that file — functions, classes, interfaces, constants.

</details>

<details>
<summary><strong>get_methods</strong> — all methods on a class</summary>

```json
{
  "class_name": "IndexerService"
}
```

</details>

---

### Call graph

<details>
<summary><strong>get_callers</strong> — who calls this function?</summary>

Traces call sites across the entire indexed codebase.

```json
{
  "symbol_name": "reindexFile"
}
```

```json
{
  "symbol_name": "handleTool",
  "class_name": "MyClass"
}
```

> **Note:** Best-effort. Dependency injection and dynamic dispatch may not resolve.

</details>

---

### Structure

<details>
<summary><strong>get_hierarchy</strong> — class inheritance and interface implementation</summary>

```json
{
  "name": "IndexerService"
}
```

Returns parent classes and implemented interfaces, resolved across files.

</details>

<details>
<summary><strong>get_related_files</strong> — imports and importers</summary>

```json
{
  "file_path": "/project/src/services/IndexerService.ts"
}
```

Returns what this file imports from, and what files import this file.

</details>

---

### Framework detection

<details>
<summary><strong>get_route_config</strong> — detect routes (Next.js, SvelteKit, Express)</summary>

Detects framework conventions and returns route configuration for the project.

</details>

<details>
<summary><strong>resolve_config</strong> — resolved TypeScript/framework config</summary>

Returns the resolved `tsconfig.json` and any detected framework config.

</details>

---

### Index control

<details>
<summary><strong>index_project</strong> — trigger a full re-scan</summary>

```json
{
  "project_root": "/path/to/project"
}
```

Skips files whose content hash hasn't changed. Safe to call anytime.

</details>

<details>
<summary><strong>flush_file</strong> — force immediate re-index of one file</summary>

```json
{
  "file_path": "/project/src/server.ts"
}
```

Bypasses the 300ms debounce. Call this right after editing a file if you need queries to reflect changes instantly.

</details>

---

## How indexing stays current

| Trigger | What happens |
|---|---|
| File saved | chokidar fires → 300ms debounce → `reindexFile` |
| File deleted | Symbols removed from index immediately |
| AI edits a file | Call `flush_file` to bypass debounce |
| Full re-scan needed | Call `index_project` |

**Two-pass scan strategy:**
Full scans run in two passes. Pass 1 indexes all symbols. Pass 2 resolves cross-file references. This ensures call graph edges are correct regardless of file processing order.

**Content hashing:**
Files are SHA-256 hashed. Unchanged files are skipped during full scans — only modified files are re-parsed.

---

## Benchmark: TSA vs Grep

Tested on a real task: *find where the MCP server starts and add a startup greeting.*

| Metric | TSA | Grep |
|---|---|---|
| Navigation tokens | ~350 | ~400 |
| File read tokens | ~150 | ~150 |
| Wrong reads | 0 | 0 |
| **Total tokens** | **~500** | **~550** |
| Steps to find target | 1 query | 3 steps |
| Gitignored files visible | Yes | No |

**Where TSA wins clearly:**
- Multi-hop call tracing (`get_callers` recursively)
- Cross-file reference resolution
- Inheritance hierarchies
- Projects with active worktrees (TSA indexes through `.gitignore`)

**Where Grep is equally fine:**
- Single known file, simple edit
- You already know exactly what to look for

TSA's value scales with codebase complexity and task depth, not task simplicity.

---

## Architecture

```
src/
├── index.ts              — entry point, wires all services
├── server.ts             — MCP server, tool dispatch
├── services/
│   ├── IndexerService    — file watching, debounce, scan orchestration
│   ├── ParserService     — ts-morph AST parsing, symbol + ref extraction
│   ├── SymbolService     — symbol queries against SQLite
│   ├── ReferenceService  — call graph queries
│   ├── DatabaseService   — SQLite schema + CRUD
│   ├── FrameworkService  — Next.js / SvelteKit / Express detection
│   └── ConfigService     — tsconfig resolution
├── tools/
│   ├── symbol-tools      — find_symbol, search_symbols, get_methods, get_file_symbols
│   ├── reference-tools   — get_callers, get_hierarchy, get_related_files
│   ├── index-tools       — index_project, flush_file
│   └── runtime-tools     — get_route_config, resolve_config
├── database/
│   ├── schema.ts         — SQLite table definitions
│   └── client.ts         — better-sqlite3 connection
└── types/
    └── env.ts            — env validation + project root detection
```

---

## Contributing

Issues and PRs welcome. The codebase indexes itself — so once you clone and run it pointed at its own directory, you can use TSA to navigate TSA.

---

## License

MIT
