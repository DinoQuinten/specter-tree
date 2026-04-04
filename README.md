# specter-tree

> TypeScript codebase intelligence for AI coding assistants — via the Model Context Protocol.

**specter-tree** gives your AI a structural index of your TypeScript project. Instead of burning tokens reading files to find symbols, it queries a live SQLite index built from the actual AST. One query. Exact file, exact line.

And unlike grep, it walks through `.gitignore` walls — worktrees, ignored directories, diverged branches. Everything indexed. Nothing hidden.

---

## The problem

Every time an AI navigates your codebase without specter-tree, it does this:

```
Task: find startServer and add a startup greeting

  Step 1  Glob all .ts files              →  31 paths listed
  Step 2  Grep for "startServer"          →  6 matching lines, scan output
  Step 3  Read server.ts (full file)      →  126 lines — needed 20
  ──────────────────────────────────────────────────────────────
  Total:  ~1350 tokens
  Lines actually needed: 20 of 126
```

With specter-tree:

```
Task: find startServer and add a startup greeting

  Step 1  find_symbol("startServer")      →  file + line 111, exact
  Step 2  Read server.ts lines 111–130    →  20 lines, nothing else
  ──────────────────────────────────────────────────────────────
  Total:  ~500 tokens
  Lines actually needed: 20 of 20
```

Same task. Same edit. **63% fewer tokens.**

---

## Why it's cheaper — three mechanisms

### 1. Partial file reads (biggest saving)

specter-tree returns exact line numbers. Claude Code reads 20 lines. Without specter-tree, Claude reads the whole file — hoping the target is in there.

```
Without specter-tree:   Read server.ts          126 lines   ~850 tokens
With specter-tree:      Read server.ts L111–130  20 lines   ~150 tokens
                                                        ─────────────────
                                                        Saved: ~700 tokens
```

This is the dominant savings category. Not discovered until measured on real code.

### 2. Navigation is cheaper, not equal

Conventional wisdom says structured queries cost more than grep. The opposite is true in practice.

`find_symbol` returns one precise result. Grep returns a list of noisy matches — file names, line numbers, matched text — that the agent has to read and sift through. More output tokens, more context consumed.

```
Grep navigation (Glob + Grep):    ~400 tokens
specter-tree navigation:          ~350 tokens
```

Small on one query. Compounds across a multi-hop task.

### 3. Zero wrong reads

When navigating blind, an AI opens files that look relevant but aren't. Each wrong read costs 300–3000 tokens depending on file size. specter-tree returns verified symbol locations. No guessing, no wrong opens.

---

## Token impact — by task depth

```
SIMPLE TASK  (find one function, make one edit)
──────────────────────────────────────────────────────────────── 1350 tok  Without
──────────────────────────── 500 tok  With specter-tree
Reduction: ~63%


MEDIUM TASK  (trace all callers, 3 hops)
────────────────────────────────────────────────────────────────────────── 2850 tok  Without
──────────────────── 900 tok  With specter-tree
Reduction: ~68%


LARGE TASK  (map full inheritance hierarchy, 15+ files)
──────────────────────────────────────────────────────────────────────────────────── 4800 tok  Without
──────────────── 1000 tok  With specter-tree
Reduction: ~79%
```

> Savings compound with task depth. The larger and deeper the navigation, the bigger the gap.

---

## Real-life scenarios

### "Add logging to every function that calls DatabaseService"

**Without specter-tree:**
Grep for `DatabaseService`, read every matching file, trace callers manually, open those files too. 12–20 file reads on a medium project.

**With specter-tree:**
```
get_callers("DatabaseService")         → all callers listed
get_file_symbols(each caller file)     → confirm which functions wrap it
Edit only those functions
```
3 tool calls. No wasted reads.

---

### "Find every class that implements IResolver"

**Without specter-tree:**
Grep for `implements IResolver`. Misses indirect implementations through parent classes. Every match requires opening the file to confirm.

**With specter-tree:**
```
get_implementations("IResolver")       → all direct implementors
get_hierarchy for ambiguous cases      → catches indirect implementations
```
Structural query. Cannot be fooled by comments, string literals, or renamed imports.

---

### Active worktree development

You're on `feat/new-auth` with a worktree at `.worktrees/feat/new-auth`. Your AI is editing `AuthService`. The worktree is gitignored.

**Grep:** sees only the main branch copy. One version of the function.

**specter-tree:** sees both — and surfaces that they have different signatures. You're warned before you edit the wrong copy.

---

### "What files break if I rename this function?"

**Without specter-tree:**
Grep for the function name. Misses aliased imports, re-exports, indirect calls. Must read every match to verify.

**With specter-tree:**
```
get_callers("functionName")            → verified call sites only
get_related_files(its file)            → all files that import it
```
Exact blast radius. Rename with confidence.

---

## Benchmark — real data, this codebase

Run live against this repository (31 TypeScript source files). Task identical in both rounds: *add a startup greeting to the MCP server.*

The benchmark was run **twice**, in opposite orders, to eliminate ordering effects.

### Results

```
         Test 1              Test 2
         (specter first)     (grep first)

TSA      ~500 tok            ~800 tok  *
Grep     ~1350 tok           ~1750 tok

Reduction  63%                 54%
```

*Test 1 used more precise partial reads. Test 2 included one SDK exploration pass that was later ruled unnecessary (see notes).

### Consistent findings across both runs

| Metric | Test 1 | Test 2 | Pattern |
|---|---|---|---|
| TSA total tokens | ~500 | ~800 | Always lower |
| Grep total tokens | ~1350 | ~1750 | Always higher |
| Reduction | 63% | 54% | 54–67% range |
| Wrong reads (TSA) | 0 | 0 | Consistent |
| Wrong reads (Grep) | 0 | 1 | Grep opens SDK |
| Steps to find target | 1 | 1 | One `find_symbol` call |
| Lines read | 20 of 126 | 20 of 126 | Targeted every time |

### Stage-by-stage breakdown (updated cost model)

```
Stage                  Without TSA          With specter-tree
─────────────────────────────────────────────────────────────
Navigation             400–450 tokens       350 tokens
Wrong file reads       0–300 tokens         0 tokens
Correct file reads     ~850 (full file)     ~150 (20 lines)
─────────────────────────────────────────────────────────────
Total (observed)       1350–1750 tokens     500–800 tokens
Reduction              —                    54–67%
```

### What the data corrected

**We initially predicted wrong reads would be the primary saving.** Actual data showed partial reads saved 2× more than wrong read elimination. The line number returned by `find_symbol` means Claude reads 20 lines instead of 126 — that's 700 tokens saved on a single file read. This was an unpredicted category.

**We predicted TSA navigation would cost more than Grep.** It costs less. `find_symbol` returns one clean result. Grep returns a list of matches the agent has to parse. More output tokens.

### What specter-tree cannot do

specter-tree indexes project symbols only. External SDK methods — `sendLoggingMessage`, `oninitialized`, anything in `node_modules` — return 0 results. Both test runs hit this wall when needing to verify the MCP SDK's notification API.

**specter-tree and Grep are complements.** Use specter-tree for all project navigation. Fall back to Grep when you need to explore an unfamiliar external API.

### The worktree finding

`find_symbol("startServer")` returned 3 results across main branch and 2 gitignored worktrees. One worktree copy had a different return type (`Promise<TsaServer>` vs `Promise<void>`) — a diverged branch invisible to Grep. The AI correctly filtered to the main project path in one pass. No human disambiguation needed.

---

## How it works

```
┌─────────────────────────────────────────────────────────┐
│                    Your TypeScript project               │
└───────────────────────┬─────────────────────────────────┘
                        │  file saved / added / deleted
                        ▼
              ┌─────────────────────┐
              │  chokidar watcher   │
              │  300ms debounce     │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────────────────────────┐
              │  ts-morph AST parser (two-pass)         │
              │  Pass 1: symbols — name, kind, line,    │
              │           signature, modifiers          │
              │  Pass 2: references — cross-file call   │
              │           graph edges                   │
              └──────────┬──────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────────────────────┐
              │  SQLite index  (.tsa/index.db)        │
              │                                       │
              │  symbols      name, kind, file, line  │
              │  references   caller → callee edges   │
              │  files        path, hash, modified    │
              └──────────┬───────────────────────────┘
                         │
                         ▼
              ┌──────────────────────────────────────┐
              │  MCP server (specter-tree)            │
              │  Claude / any MCP client queries here │
              └──────────────────────────────────────┘
```

### Index freshness

| Event | Latency | Mechanism |
|---|---|---|
| File saved | 300ms | chokidar debounce → `reindexFile` |
| File deleted | Immediate | DB entry removed instantly |
| AI edits a file | Instant | `flush_file` bypasses debounce |
| Cold start | One-time scan | Two-pass, hash-skips unchanged files |
| Manual re-scan | On demand | `index_project` tool |

---

## Tools

### Find symbols

| Tool | What it does |
|---|---|
| `find_symbol(name, kind?)` | Exact name lookup → file, line, signature |
| `search_symbols(query, kind?, limit?)` | Partial name search (LIKE matching) |
| `get_file_symbols(file, kind?)` | All symbols declared in a file |
| `get_methods(class_name)` | All methods on a class |

### Trace relationships

| Tool | What it does |
|---|---|
| `get_callers(symbol, class?)` | All call sites for a function or method |
| `get_hierarchy(class_name)` | Parent classes + implemented interfaces |
| `get_implementations(interface)` | All classes that implement an interface |
| `get_related_files(file)` | What this file imports + what imports it |

### Framework detection

| Tool | What it does |
|---|---|
| `get_route_config()` | Detect routes — Next.js, SvelteKit, Express |
| `resolve_config()` | Resolved tsconfig + framework config |

### Index control

| Tool | What it does |
|---|---|
| `flush_file(path)` | Force immediate re-index, bypass debounce |
| `index_project(root)` | Full project re-scan (skips unchanged files) |

---

## Quick start

**Prerequisites:** [Bun](https://bun.sh)

```bash
git clone https://github.com/your-username/specter-tree
cd specter-tree/tsa-mcp-server
bun install
```

Add to `.mcp.json` (Claude Code) or your MCP client config:

```json
{
  "mcpServers": {
    "tsa": {
      "command": "bun",
      "args": ["run", "/path/to/specter-tree/tsa-mcp-server/src/index.ts"],
      "env": {
        "TSA_PROJECT_ROOT": "/path/to/your/typescript/project"
      }
    }
  }
}
```

specter-tree scans on first run and stays live. No further setup needed.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TSA_PROJECT_ROOT` | No | Auto-detected | TypeScript project to index |
| `TSA_DB_PATH` | No | `{root}/.tsa/index.db` | SQLite index location |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | No | `development` | `development` / `production` |

**Auto-detection order for project root:**
1. `--project <path>` CLI flag
2. `TSA_PROJECT_ROOT` env var
3. Nearest `tsconfig.json` walking up from `cwd`
4. `cwd` as fallback

---

## License

MIT
