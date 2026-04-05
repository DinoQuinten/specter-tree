<div align="center">

# specter-tree

**Give your AI a map of your TypeScript codebase**

*Instead of reading 10 files to find one function — ask once, get the exact line.*

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6.svg)](https://bun.sh)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-MCP-8b5cf6.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178c6.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## What is this?

specter-tree is a TypeScript-aware MCP server. It builds a live structural index of your codebase so coding agents like Claude Code, Codex, and Cursor-compatible clients can ask for exact symbols, call sites, routes, and config values instead of searching blindly through files.

- *Where is `handleLogin` defined?* → exact file + line number, instantly
- *What calls `validateUser`?* → every call site across your whole project
- *What does this class extend?* → full inheritance chain

Without specter-tree, the agent scans grep output, reads whole files, and often opens the wrong place first. With specter-tree, it asks one structural question and gets one precise answer.

---

## The promise

Normal workflow:

1. Clone this repo and run `bun run dev`.
2. `specter-tree` prints the MCP JSON and the prompt text you need.
3. Open Codex in the project you actually want to work on.
4. Paste the printed output into Codex.
5. Codex configures the MCP connection, binds `tsa` to the current workspace, and starts navigating with `tsa` before grep/glob.

---

## What is MCP?

MCP (Model Context Protocol) is the standard way coding agents connect to tools. `specter-tree` is one MCP server. Once connected, the agent can call its structural code-navigation tools during the conversation instead of relying on text search.

The key model here is simple: your coding agent launches the `specter-tree` stdio server for the session, then `specter-tree` binds itself to the current workspace root from inside that session.

---

## Start in 3 steps

### 1. Install `specter-tree`

Install [Bun](https://bun.sh) if needed, then:

```bash
git clone https://github.com/DinoQuinten/specter-tree.git
cd specter-tree/tsa-mcp-server
bun install
```

### 2. Run the server once

From `specter-tree/tsa-mcp-server`:

```bash
bun run dev
```

The startup output prints:

- the MCP JSON/config Codex needs
- the prompt text telling Codex how to connect and use `tsa`
- the currently detected root for visibility/debugging

This is the intended onboarding flow. The user should copy what `bun run dev` prints and paste it into Codex.

### 3. Paste the printed output into Codex

Open Codex in the project you actually want to work on, then paste the printed setup block from `bun run dev`.

Codex should then:

- add or update the MCP configuration for `tsa`
- confirm the server is available
- call `set_project_root` with the current workspace root
- start using `tsa` for navigation immediately

If you want to see the prompt again without starting a full new session, you can also use:

```bash
bun run dev --prompt
```

## What Codex will use under the hood

The printed output contains MCP config in this shape:

```json
{
  "mcpServers": {
    "tsa": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/specter-tree/tsa-mcp-server/src/index.ts"]
    }
  }
}
```

Codex is expected to take that config and do the MCP setup work. Manual editing of `.mcp.json` should be treated as a fallback, not the main path.

For advanced/manual debugging, you can still:

```bash
bun run dev --project /path/to/project
TSA_PROJECT_ROOT=/path/to/project bun run dev
```

---

## What happens after you paste the prompt

The agent should:

1. use the printed MCP JSON/config to connect `tsa`
2. confirm that the `tsa` MCP server is available
3. inspect the available `tsa` tools/resources
4. call `set_project_root` with the active workspace root
5. find the exact symbol/file/route with `tsa`
6. read only the smallest code region it needs
7. call `flush_file` after editing so the index stays fresh

That is the entire intended onboarding flow. Users should not need to hardcode `TSA_PROJECT_ROOT` in normal setup.

---

## The problem it solves

Without specter-tree, every navigation task burns tokens:

```
Task: find startServer and add a startup greeting

  Step 1  Glob all .ts files              ->  31 paths listed
  Step 2  Grep for "startServer"          ->  6 matching lines, scan output
  Step 3  Read server.ts (full file)      ->  126 lines — needed 20
  ──────────────────────────────────────────────────────────────
  Total:  ~1350 tokens        Lines actually needed: 20 of 126
```

With specter-tree:

```
Task: find startServer and add a startup greeting

  Step 1  find_symbol("startServer")      ->  server.ts line 111, exact
  Step 2  Read server.ts lines 111-130    ->  20 lines, nothing else
  ──────────────────────────────────────────────────────────────
  Total:  ~500 tokens         Lines actually needed: 20 of 20
```

Same task. Same edit. **63% fewer tokens.**

Savings grow with task complexity:

```
SIMPLE  find one function, edit it
██████████████████████████████████████████████████  1350 tok  Grep
██████████████████                                   500 tok  specter-tree    63% saved

MEDIUM  trace callers across 3 files
█████████████████████████████████████████████████████████████████████  2850 tok  Grep
████████████████████                                                   900 tok  specter-tree    68% saved

LARGE   map full inheritance, 15+ files
████████████████████████████████████████████████████████████████████████████████  4800 tok  Grep
████████████████                                                                 1000 tok  specter-tree    79% saved
```

---

## How it works

There are two moving parts:

1. **The specter-tree server** — runs on your machine, watches the currently bound TypeScript project, and keeps a SQLite index of every symbol and reference. Uses zero tokens.

2. **Your AI agent** — Claude Code, Codex, Cursor, etc. Once connected, it calls specter-tree tools during the conversation instead of reading raw files first.

The key thing to understand: **the server and your AI agent are separate processes.** The client launches the server, and the agent then binds that server to the current workspace root with `set_project_root`.

```mermaid
flowchart TB
    subgraph YourMachine["Your Machine"]
        subgraph Project["Your TypeScript Project"]
            FS["*.ts / *.tsx files"]
        end

        subgraph Server["specter-tree server (background)"]
            CK["chokidar watcher\n300ms debounce"]
            PM["ts-morph AST parser"]
            DB[("SQLite index\n.tsa/index.db")]
        end
    end

    subgraph Agent["Your AI Agent"]
        CC["Claude Code / Cursor / Codex"]
    end

    FS -->|file change| CK
    CK --> PM
    PM -->|symbols + refs| DB
    DB <-->|MCP stdio| Agent

    style YourMachine fill:#0d1117,stroke:#534AB7,color:#fff
    style Project fill:#1a1a2e,stroke:#534AB7,color:#fff
    style Server fill:#1a1a2e,stroke:#1D9E75,color:#fff
    style Agent fill:#1a1a2e,stroke:#a855f7,color:#fff
```

---

## What can your AI do now?

Once connected, your AI has 17 structural tools instead of blind file reading:

### Find things

| Tool | What it does |
|---|---|
| `find_symbol(name)` | Locate any function, class, interface by exact name → returns file + line |
| `search_symbols(query)` | Fuzzy/partial name search across the whole project |
| `get_file_symbols(file_path)` | List every symbol declared in a file |
| `get_methods(class_name)` | All methods and properties on a class |

### Understand relationships

| Tool | What it does |
|---|---|
| `get_callers(symbol_name)` | Every place in the project that calls this function |
| `get_hierarchy(class_name)` | What does this class extend? What does it implement? |
| `get_implementations(interface_name)` | All classes that implement this interface |
| `get_related_files(file_path)` | What does this file import? What imports it? |

### Framework and config

| Tool | What it does |
|---|---|
| `trace_middleware(route_path)` | What middleware runs before this route handler? |
| `get_route_config(url_path)` | Route handler, guards, and redirects for a URL |
| `resolve_config(key)` | What is this config value and where does it come from? |

### High-level insight (saves the most tokens)

| Tool | What it does |
|---|---|
| `summarize_file_structure(file_path)` | Compact anatomy of a file — exports, classes, functions, imports |
| `explain_flow(symbol/file/route)` | Trace the call graph from any entrypoint |
| `find_write_targets(symbol_name)` | Ranked list of where to actually make an edit |
| `resolve_exports(file_path, name)` | Follow barrel re-exports to the actual declaration file |

### Index control

| Tool | What it does |
|---|---|
| `set_project_root(project_root)` | Bind `tsa` to the current workspace root and index it for this agent session |
| `flush_file(file_path)` | Force immediate re-index after an edit (bypasses the 300ms debounce) |
| `index_project(root)` | Full re-scan of the active root |

### Browse without tool calls (MCP Resources)

| URI | Returns |
|---|---|
| `tsa://files` | All indexed TypeScript file paths |
| `tsa://symbols` | All distinct symbol names |
| `tsa://file/{path}` | Every symbol in a specific file |
| `tsa://symbol/{name}` | Full record for a named symbol |

---

## Environment variables and overrides

| Variable | Required | Default | Description |
|---|---|---|---|
| `TSA_PROJECT_ROOT` | No | Auto-detected | Advanced override for the initial project root before `set_project_root` is called |
| `TSA_DB_PATH` | No | `{root}/.tsa/index.db` | Where to store the SQLite index |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | No | `development` | `development` / `production` |

In normal usage, you should not need to set `TSA_PROJECT_ROOT` manually. The agent should call `set_project_root` for the active workspace after it connects.

**If no override is provided, the initial root is detected in this order:**

1. `--project <path>` CLI flag
2. `TSA_PROJECT_ROOT` env var
3. Nearest `tsconfig.json` found walking up from the current directory
4. Current directory as last resort

---

## Benchmark — real data, this codebase

Run against this repository (31 TypeScript source files). Same task both rounds: *add a startup greeting to the MCP server.* Run twice in opposite orders to eliminate first-run bias.

```
                    Test 1              Test 2
                    (specter first)     (grep first)

specter-tree        ~500 tok            ~800 tok
Grep + Read         ~1350 tok           ~1750 tok

Reduction           63%                 54%
```

| Stage | Without specter-tree | With specter-tree | Saving |
|---|---|---|---|
| Navigation | 400-450 tok | ~350 tok | ~15% |
| Wrong file reads | 0-300 tok | 0 tok | 100% |
| Correct file reads | ~850 tok (full file) | ~150 tok (20 lines) | ~82% |
| **Total** | **1350-1750 tok** | **500-800 tok** | **54-67%** |

**What the data corrected:** We predicted wrong reads would dominate. They didn't. The biggest saving was partial reads — `find_symbol` returns the exact line so the AI reads 20 lines instead of a 126-line file. That single mechanism accounts for more than half the total saving.

---

## Limitations

specter-tree indexes **your project files only**. External packages in `node_modules` return no results — for those, fall back to grep. Both benchmark runs hit this when looking up methods from the MCP SDK.

The call graph is **best-effort, not exhaustive**. Known gaps:

- Dependency injection (`@Inject` providers)
- Event emitters (string-based event names)
- Dynamic dispatch (`obj[methodName]()`)
- Higher-order functions and callbacks
- Re-exports through barrel files

All call graph results include a `confidence` field: `direct`, `inferred`, or `weak`.

---

## Under the hood

```mermaid
erDiagram
    SYMBOLS {
        int id PK
        text name
        text kind
        text file_path
        int line
        text signature
        text modifiers
        int parent_id FK
    }
    REFERENCES {
        int id PK
        int source_symbol_id FK
        int target_symbol_id FK
        text ref_kind
        text confidence
    }
    FILES {
        text path PK
        int last_modified
        text content_hash
        int symbol_count
    }
    SYMBOLS ||--o{ SYMBOLS : "parent_id (class > method)"
    SYMBOLS ||--o{ REFERENCES : "source (caller)"
    SYMBOLS ||--o{ REFERENCES : "target (callee)"
    FILES ||--o{ SYMBOLS : "file_path"
```

SQLite B+trees for all symbol and reference storage. Lookups are O(log n), typically 3-4 page reads for 5,000 symbols. Sub-millisecond. The call graph uses an adjacency list (not closure tables) — writes are O(1) per edge, multi-hop traversals use recursive CTEs.

---

## Contributing

### Add a language

The parser is TypeScript-only (ts-morph). To add Python, Go, Rust, or anything else:

1. Implement the parser interface alongside `src/services/ParserService.ts`
2. Return the same `Symbol[]` and `Reference[]` structures
3. Register it for file extensions in `IndexerService`

### Add a framework

`trace_middleware` and `get_route_config` use the `IFrameworkResolver` interface. Currently supported: Express, Next.js, SvelteKit.

To add Fastify, Hono, Remix, Nuxt:

1. Create `src/framework/your-framework-resolver.ts`
2. Implement `IFrameworkResolver`
3. Add detection in `FrameworkService.detectFrameworks()`

### Development

```bash
git clone https://github.com/DinoQuinten/specter-tree.git
cd specter-tree/tsa-mcp-server
bun install
bun test              # 82 tests
bun run typecheck     # type check
bun run dev           # start server
```

Hooks: pre-commit checks for secrets (gitleaks) and duplicate symbols. Pre-push runs tests + typecheck.

---

## Roadmap

- [x] Layer 1: Offline indexer with incremental updates
- [x] Layer 2: Symbol and reference query tools
- [x] Layer 3: Framework detection + config resolution
- [x] Layer 4: Insight tools — summarize, resolve exports, write targets, flow
- [x] MCP Resources for index browsing without tool calls
- [x] Graceful shutdown with in-flight request drain
- [x] Coloured startup banner with ready-to-paste agent prompt
- [x] `--prompt` flag generates exact connection config with real paths
- [x] Benchmark against Claude Code native tools
- [ ] npm package for `npx` installation
- [ ] Language parser plugin system
- [ ] Python parser (tree-sitter)
- [ ] Selective node_modules indexing for external SDK types
- [ ] Batch query tool (multiple queries in one MCP call)

---

## License

AGPL-3.0-only
