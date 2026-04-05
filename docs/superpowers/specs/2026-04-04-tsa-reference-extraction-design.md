# TSA Reference Extraction — Design Spec

**Date:** 2026-04-04  
**Status:** Approved for implementation  
**Branch:** feat/tsa-mcp-server

---

## 1. Overview

The references table is never populated in production. `extractReferences` in `ParserService` is a stub that is never called from `IndexerService.reindexFile`. This means `get_callers`, `get_related_files`, `get_hierarchy`, and `get_implementations` all return zero results on real projects.

This spec defines the fix: a two-pass reference extraction pipeline that populates the references table with `imports`, `extends`, `implements`, and `calls` edges resolved to actual symbol IDs.

---

## 2. Decisions

### Cross-file resolution (A2)
Full cross-file call graph. A file-scope-only graph misses the most valuable queries — "who calls `redirectToLogin`?" almost always crosses file boundaries. Two-pass cost is paid once on initial scan; incremental updates (single file change) resolve in one pass against the existing symbols table.

### Project-only symbols
Only track calls to symbols that exist in the project's own symbols table. `console.log`, `res.json()`, `express()` are excluded. Including them would bloat the references table 5-10x with zero debugging value.

### Resolve by (name + file path), not name only
Two files can export different symbols with the same name:
```typescript
// src/utils/auth.ts
export function validate() { ... }

// src/utils/form.ts
export function validate() { ... }
```
Resolving by name alone returns both. The fix: when the import source is available from an `ImportDeclaration`, resolve by `(name + file_path)`. Fall back to name-only for same-file calls. Uses existing `idx_symbols_file_kind` index.

---

## 3. Named Reference Type

`ParserService.extractReferences` returns `NamedRef[]` — named references before ID resolution:

```typescript
interface NamedRef {
  sourceName: string;        // name of the symbol making the reference
  sourceFile: string;        // absolute path of the source file
  targetName: string;        // name of the symbol being referenced
  targetFile: string | null; // resolved import path when known, null for same-file calls
  ref_kind: 'calls' | 'imports' | 'extends' | 'implements';
  source_line: number | null;
  confidence: 'direct' | 'inferred' | 'weak';
}
```

---

## 4. Changes Required

### 4a. `src/types/common.ts`
Add `NamedRef` interface (exported). Remove or keep `TsaReference` — still used by `DatabaseService.insertReferences` for direct ID-based inserts in tests.

### 4b. `src/services/ParserService.ts`
Redesign `extractReferences(filePath, knownSymbolNames)`:
- `knownSymbolNames: Set<string>` — project symbol names for filtering calls
- Build an import map: `importedName → absoluteFilePath` from all `ImportDeclaration` nodes
- Extract `imports` edges: one per import declaration (source = first exported symbol or file-level ref)
- Extract `extends` / `implements` edges: from class declarations, resolve via import map
- Extract `calls` edges: traverse all `CallExpression` nodes, get callee name, skip if not in `knownSymbolNames`, resolve file via import map if available
- Return `NamedRef[]`

### 4c. `src/services/DatabaseService.ts`
Add two methods:

**`deleteFileReferences(filePath: string): void`**  
Deletes all references where the source symbol belongs to `filePath`. Uses:
```sql
DELETE FROM "references" WHERE source_symbol_id IN (
  SELECT id FROM symbols WHERE file_path = ?
)
```

**`resolveAndInsertNamedRefs(refs: NamedRef[]): void`**  
For each `NamedRef`:
1. Look up `source_symbol_id`: `SELECT id FROM symbols WHERE name = ? AND file_path = ?`
2. Look up `target_symbol_id`:
   - If `targetFile` is not null: `SELECT id FROM symbols WHERE name = ? AND file_path = ?`
   - If `targetFile` is null: `SELECT id FROM symbols WHERE name = ?` (first match, same-file bias)
3. Skip if either ID not found
4. Insert into `"references"` table
Wrapped in a single transaction for performance.

### 4d. `src/services/IndexerService.ts`
**`reindexFile(filePath)`** — after `insertSymbols`:
1. Call `db.deleteFileReferences(filePath)`
2. Call `parser.extractReferences(filePath, knownSymbolNames)` where `knownSymbolNames` is fetched from DB via a new `getAllSymbolNames(): Set<string>` method
3. Call `db.resolveAndInsertNamedRefs(namedRefs)`

**`scanProject(projectRoot)`** — two-pass:
- Pass 1 (existing): index all symbols across all files
- Pass 2 (new): for each file, delete old refs + extract + resolve. Done after all symbols are indexed so cross-file resolution succeeds.

---

## 5. New DatabaseService Method

**`getAllSymbolNames(): Set<string>`**  
```sql
SELECT DISTINCT name FROM symbols
```
Called once before the reference extraction pass. Used to filter `calls` edges to project-only symbols.

---

## 6. Import Path Resolution

`ParserService` resolves import specifiers to absolute paths using Node.js `path.resolve`:

```typescript
// import { validate } from './utils/auth'
// sourceFile = /project/src/handlers/login.ts
// → targetFile = /project/src/handlers/utils/auth.ts (if .ts exists)
// → targetFile = /project/src/handlers/utils/auth/index.ts (fallback)
```

Try `.ts` first, then `/index.ts`. If neither exists on disk, `targetFile` is `null` (unresolvable — skip for `extends`/`implements`, keep with null for `calls`).

---

## 7. Test Plan

### Unit tests (new/updated)
- `DatabaseService.test.ts`: `deleteFileReferences`, `resolveAndInsertNamedRefs` (with and without `targetFile`, duplicate skipping, name collision resolution)
- `ParserService.test.ts`: `extractReferences` on `simple-ts-project/src/animals.ts` — verify `extends` edges for `Dog`/`Cat` → `Animal`, `implements` edges, import edges from `utils.ts`

### Integration test update
- `test/integration.test.ts`: after `scanProject`, verify `get_callers` for `greetAnimal` returns `makeGreeting` as caller (cross-file: `utils.ts` calls `greetAnimal` from `animals.ts`)

---

## 8. Out of Scope

- `type_ref` and `decorator` ref kinds — not extracted in this phase
- Multi-hop call graph queries (recursive CTE) — not in this phase
- Dynamic dispatch, DI-injected calls — explicitly excluded (confidence: 'weak' if attempted)
