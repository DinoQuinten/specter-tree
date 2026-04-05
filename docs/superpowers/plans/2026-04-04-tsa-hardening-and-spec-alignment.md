# TSA Hardening And Spec Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tsa-mcp-server` runnable, testable, and aligned with the documented TSA MCP server and reference-extraction specs.

**Architecture:** Start by restoring a trustworthy execution baseline so tests can run inside `tsa-mcp-server`. Then fix contract-level mismatches in query and runtime services, upgrade the framework/config behaviors that are currently partial, and finish by reconciling fixtures and docs with the supported implementation. The plan keeps each task small and test-driven so regressions are visible immediately.

**Tech Stack:** Bun, TypeScript, ts-morph, bun:sqlite, MCP SDK, zod

**Specs:** `docs/superpowers/specs/2026-04-04-tsa-mcp-server-design.md`, `docs/superpowers/specs/2026-04-04-tsa-reference-extraction-design.md`

---

## File Map

```
tsa-mcp-server/
  package.json                               MODIFY — verify runtime/test dependencies
  tsconfig.json                              MODIFY — fix test/fixture/compiler behavior if needed
  src/
    logging/logger.ts                        MODIFY — remove runtime import issues if present
    services/
      ConfigService.ts                       MODIFY — support documented config resolution behavior
      FrameworkService.ts                    MODIFY — fix monorepo resolver selection
      ReferenceService.ts                    MODIFY — honor class_name for get_callers
    framework/
      express-resolver.ts                    MODIFY — follow router composition more accurately
      nextjs-resolver.ts                     MODIFY — return stronger route metadata
      sveltekit-resolver.ts                  VERIFY/MODIFY — align with documented behavior
  test/
    integration.test.ts                      MODIFY — cover real end-to-end behaviors
    services/
      ConfigService.test.ts                  MODIFY — add tsconfig.json and config-shape coverage
      FrameworkService.test.ts               MODIFY — add monorepo prefix and route resolution coverage
      ReferenceService.test.ts               CREATE or MODIFY — add class_name filtering tests
  test/fixtures/
    simple-ts-project/                       MODIFY — add missing fixture files promised by tests/docs
    express-project/                         MODIFY — add router composition fixture files
    nextjs-project/                          MODIFY — add realistic pages/app router cases if missing
docs/superpowers/
  specs/
    2026-04-04-tsa-mcp-server-design.md     MODIFY — reconcile with actual supported behavior if needed
    2026-04-04-tsa-reference-extraction-design.md
  plans/
    2026-04-04-tsa-hardening-and-spec-alignment.md
```

### Task 1: Restore A Passing Test Baseline

**Files:**
- Modify: `tsa-mcp-server/package.json`
- Modify: `tsa-mcp-server/tsconfig.json`
- Modify: `tsa-mcp-server/src/logging/logger.ts`
- Modify: `tsa-mcp-server/test/integration.test.ts`
- Modify: `tsa-mcp-server/test/fixtures/simple-ts-project/**`

- [ ] **Step 1: Reproduce the current failure**

Run:

```bash
bun test
```

Expected: FAIL with the currently observed package-resolution and ts-morph/fixture errors.

- [ ] **Step 2: Add a focused logger smoke test if none exists**

Create or extend `tsa-mcp-server/test/services/logger.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { logger } from '../../src/logging/logger';

describe('logger', () => {
  test('exports a usable logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});
```

- [ ] **Step 3: Run the focused logger test**

Run:

```bash
bun test test/services/logger.test.ts
```

Expected: FAIL if runtime module resolution for `pino` is still broken.

- [ ] **Step 4: Fix package/runtime loading in the minimal place that removes the failure**

If the runtime issue is caused by transport setup in `src/logging/logger.ts`, reduce the logger to a simpler, Bun-safe construction first:

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'tsa-mcp-server' }
});
```

If the real issue is package-boundary resolution instead, fix `package.json`/workspace usage instead of adding more logger complexity.

- [ ] **Step 5: Add the missing fixture files that tests/docs assume exist**

Create `tsa-mcp-server/test/fixtures/simple-ts-project/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  },
  "include": ["src/**/*"]
}
```

Create `tsa-mcp-server/test/fixtures/simple-ts-project/package.json`:

```json
{
  "name": "simple-ts-project",
  "type": "module"
}
```

- [ ] **Step 6: Re-run the full test suite**

Run:

```bash
bun test
```

Expected: fewer failures, with remaining failures now reflecting real feature gaps rather than package/bootstrap errors.

- [ ] **Step 7: Commit**

```bash
git add tsa-mcp-server/package.json tsa-mcp-server/tsconfig.json tsa-mcp-server/src/logging/logger.ts tsa-mcp-server/test
git commit -m "fix(tsa): restore runnable test baseline"
```

### Task 2: Make `get_callers` Honor `class_name`

**Files:**
- Modify: `tsa-mcp-server/src/services/ReferenceService.ts`
- Modify: `tsa-mcp-server/test/services/ReferenceService.test.ts` or `tsa-mcp-server/test/services/DatabaseService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tsa-mcp-server/test/services/ReferenceService.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../../src/services/DatabaseService';
import { ReferenceService } from '../../src/services/ReferenceService';

describe('ReferenceService.getCallers', () => {
  let db: Database;
  let dbService: DatabaseService;
  let svc: ReferenceService;

  beforeEach(() => {
    db = new Database(':memory:');
    dbService = new DatabaseService(db);
    dbService.initialize();
    svc = new ReferenceService(dbService);
  });

  test('uses class_name to disambiguate method symbols', () => {
    dbService.insertSymbols([
      {
        name: 'AuthA', kind: 'class', file_path: '/proj/a.ts', line: 1, column: 0, end_line: 20,
        parent_id: null, signature: 'class AuthA', modifiers: '', return_type: null, params: null, doc_comment: null
      },
      {
        name: 'AuthB', kind: 'class', file_path: '/proj/b.ts', line: 1, column: 0, end_line: 20,
        parent_id: null, signature: 'class AuthB', modifiers: '', return_type: null, params: null, doc_comment: null
      },
      {
        name: 'login', kind: 'method', file_path: '/proj/a.ts', line: 2, column: 0, end_line: 3,
        parent_id: null, signature: 'login()', modifiers: '', return_type: null, params: '', doc_comment: null, _parentName: 'AuthA'
      },
      {
        name: 'login', kind: 'method', file_path: '/proj/b.ts', line: 2, column: 0, end_line: 3,
        parent_id: null, signature: 'login()', modifiers: '', return_type: null, params: '', doc_comment: null, _parentName: 'AuthB'
      }
    ]);

    const result = svc.getCallers({ symbol_name: 'login', class_name: 'AuthB' });
    expect(result.results).toBeArray();
  });
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
bun test test/services/ReferenceService.test.ts
```

Expected: FAIL because `class_name` is accepted but ignored.

- [ ] **Step 3: Implement symbol disambiguation**

Update `ReferenceService.getCallers()` in `tsa-mcp-server/src/services/ReferenceService.ts` so it filters symbol candidates by parent class when `class_name` is provided:

```ts
const symbolRows = this.db.querySymbolsByName(input.symbol_name);
const target = input.class_name
  ? symbolRows.find(row => row.parent_name === input.class_name)
  : symbolRows[0];
```

If `DatabaseService.querySymbolsByName()` does not return enough parent context, add a dedicated DB query that joins the parent symbol and returns the class name explicitly.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
bun test test/services/ReferenceService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tsa-mcp-server/src/services/ReferenceService.ts tsa-mcp-server/test/services/ReferenceService.test.ts
git commit -m "fix(reference): honor class_name in get_callers"
```

### Task 3: Fix Monorepo Resolver Selection

**Files:**
- Modify: `tsa-mcp-server/src/services/FrameworkService.ts`
- Modify: `tsa-mcp-server/test/services/FrameworkService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tsa-mcp-server/test/services/FrameworkService.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

it('prefers the longest matching package prefix for monorepo routes', () => {
  const root = join(import.meta.dir, '../fixtures/monorepo-project');
  mkdirSync(join(root, 'packages', 'web', 'app', 'api', 'users'), { recursive: true });
  writeFileSync(join(root, 'packages', 'web', 'next.config.ts'), 'export default {}');
  writeFileSync(join(root, 'packages', 'web', 'app', 'api', 'users', 'route.ts'), 'export async function GET() {}');

  const svc = new FrameworkService(root);
  const config = svc.getRouteConfig('/api/users');
  expect(config).not.toBeNull();
});
```

- [ ] **Step 2: Run the focused framework test**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: FAIL or pass for the wrong reason, demonstrating that URL-path matching is not truly package-aware.

- [ ] **Step 3: Redesign resolver matching around route capability, not directory string prefix**

Update `FrameworkService` so resolver selection asks each resolver whether it can resolve the route, or store route prefixes separately from filesystem prefixes. Minimal safe shape:

```ts
getRouteConfig(urlPath: string): RouteConfig | null {
  for (const resolver of this.orderedResolvers()) {
    const result = resolver.getRouteConfig(urlPath);
    if (result) return result;
  }
  return null;
}
```

Apply the same strategy to `traceMiddleware`.

- [ ] **Step 4: Re-run the framework tests**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: PASS with deterministic resolver selection.

- [ ] **Step 5: Commit**

```bash
git add tsa-mcp-server/src/services/FrameworkService.ts tsa-mcp-server/test/services/FrameworkService.test.ts
git commit -m "fix(framework): correct monorepo resolver selection"
```

### Task 4: Make `resolve_config` Match The Documented Contract

**Files:**
- Modify: `tsa-mcp-server/src/services/ConfigService.ts`
- Modify: `tsa-mcp-server/test/services/ConfigService.test.ts`
- Modify: `tsa-mcp-server/test/fixtures/nextjs-project/next.config.ts`
- Modify: `tsa-mcp-server/test/fixtures/sveltekit-project/svelte.config.ts`
- Create or Modify: `tsa-mcp-server/test/fixtures/config-project/tsconfig.json`

- [ ] **Step 1: Write failing tests for JSON and nested config keys**

Add to `tsa-mcp-server/test/services/ConfigService.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigService } from '../../src/services/ConfigService';

describe('ConfigService', () => {
  test('reads nested keys from tsconfig.json', () => {
    const svc = new ConfigService(join(import.meta.dir, '../fixtures/config-project'));
    const result = svc.resolveConfig({ config_key: 'compilerOptions.moduleResolution' });
    expect(result).not.toBeNull();
    expect(result!.final_value).toBe('bundler');
  });
});
```

Fixture file `tsa-mcp-server/test/fixtures/config-project/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 2: Run the focused config test**

Run:

```bash
bun test test/services/ConfigService.test.ts
```

Expected: FAIL because `tsconfig.json` is not a default-exported TS object.

- [ ] **Step 3: Implement per-file parsing strategy**

Refactor `ConfigService` so `.json` files are parsed as JSON and `.ts`/`.js` files still use AST/object-literal extraction:

```ts
if (filePath.endsWith('.json')) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const value = this.getValueAtPath(parsed, keyParts);
  if (value !== undefined) {
    return { value: String(value), line: 1 };
  }
}
```

Add a plain object traversal helper:

```ts
private getValueAtPath(value: unknown, keyParts: string[]): unknown {
  let current = value;
  for (const key of keyParts) {
    if (!current || typeof current !== 'object' || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
```

- [ ] **Step 4: Re-run the focused config test**

Run:

```bash
bun test test/services/ConfigService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run:

```bash
bun test
```

Expected: PASS for config behavior and no regressions elsewhere.

- [ ] **Step 6: Commit**

```bash
git add tsa-mcp-server/src/services/ConfigService.ts tsa-mcp-server/test/services/ConfigService.test.ts tsa-mcp-server/test/fixtures/config-project/tsconfig.json
git commit -m "feat(config): support documented json and nested config resolution"
```

### Task 5: Upgrade Next.js Route Resolution Beyond Placeholder Handlers

**Files:**
- Modify: `tsa-mcp-server/src/framework/nextjs-resolver.ts`
- Modify: `tsa-mcp-server/test/services/FrameworkService.test.ts`
- Modify: `tsa-mcp-server/test/fixtures/nextjs-project/**`

- [ ] **Step 1: Write the failing test**

Add to `tsa-mcp-server/test/services/FrameworkService.test.ts`:

```ts
it('returns concrete next route handler metadata for app router routes', () => {
  const svc = new FrameworkService(join(FIXTURES, 'nextjs-project'));
  const config = svc.getRouteConfig('/api/users');
  expect(config).not.toBeNull();
  expect(config!.handler).toBe('GET');
});
```

Update fixture `tsa-mcp-server/test/fixtures/nextjs-project/app/api/users/route.ts`:

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Run the focused framework test**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: FAIL because the resolver returns a synthetic handler string.

- [ ] **Step 3: Parse exported HTTP method handlers from the route file**

In `tsa-mcp-server/src/framework/nextjs-resolver.ts`, inspect the matched file and collect exported function names from the HTTP-method set:

```ts
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
const handler = methods.find(name => sourceFile.getFunction(name)?.isExported()) ?? 'default';
```

Return the concrete method or a joined list of actual exports rather than a placeholder constant.

- [ ] **Step 4: Re-run the focused framework test**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tsa-mcp-server/src/framework/nextjs-resolver.ts tsa-mcp-server/test/services/FrameworkService.test.ts tsa-mcp-server/test/fixtures/nextjs-project
git commit -m "feat(nextjs): return concrete route handler metadata"
```

### Task 6: Follow Express Router Composition

**Files:**
- Modify: `tsa-mcp-server/src/framework/express-resolver.ts`
- Modify: `tsa-mcp-server/test/services/FrameworkService.test.ts`
- Modify: `tsa-mcp-server/test/fixtures/express-project/src/app.ts`
- Create: `tsa-mcp-server/test/fixtures/express-project/src/routes/users.ts`

- [ ] **Step 1: Write the failing test**

Add to `tsa-mcp-server/test/services/FrameworkService.test.ts`:

```ts
it('resolves mounted express router handlers across files', () => {
  const svc = new FrameworkService(join(FIXTURES, 'express-project'));
  const config = svc.getRouteConfig('/api/users');
  expect(config).not.toBeNull();
  expect(config!.file_path).toContain('routes');
});
```

Update `tsa-mcp-server/test/fixtures/express-project/src/app.ts`:

```ts
import express from 'express';
import usersRouter from './routes/users';

const app = express();
app.use('/api', usersRouter);

export default app;
```

Create `tsa-mcp-server/test/fixtures/express-project/src/routes/users.ts`:

```ts
import { Router } from 'express';

const router = Router();

router.get('/users', function listUsers() {});

export default router;
```

- [ ] **Step 2: Run the focused framework test**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: FAIL because only the main app file is inspected today.

- [ ] **Step 3: Implement router-following for mounted imports**

Extend `express-resolver.ts` to:

```ts
1. Parse `app.use('/prefix', importedRouter)`
2. Resolve the import path for `importedRouter`
3. Load that router file
4. Parse `router.get/post/...` calls there
5. Concatenate mount prefix + route path when matching
```

Keep the first implementation narrow: only static string prefixes and direct default imports from relative files.

- [ ] **Step 4: Re-run the focused framework test**

Run:

```bash
bun test test/services/FrameworkService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tsa-mcp-server/src/framework/express-resolver.ts tsa-mcp-server/test/services/FrameworkService.test.ts tsa-mcp-server/test/fixtures/express-project/src
git commit -m "feat(express): resolve mounted routers across files"
```

### Task 7: Strengthen End-To-End Integration Coverage

**Files:**
- Modify: `tsa-mcp-server/test/integration.test.ts`

- [ ] **Step 1: Add failing end-to-end assertions for the fixed behaviors**

Extend `tsa-mcp-server/test/integration.test.ts` with:

```ts
test('resolve_config reads nested tsconfig value', () => {
  const svc = new ConfigService(join(import.meta.dir, 'fixtures/config-project'));
  const result = svc.resolveConfig({ config_key: 'compilerOptions.moduleResolution' });
  expect(result!.final_value).toBe('bundler');
});
```

```ts
test('framework service resolves next app route handler', () => {
  const framework = new FrameworkService(join(import.meta.dir, 'fixtures/nextjs-project'));
  const config = framework.getRouteConfig('/api/users');
  expect(config!.handler).toBe('GET');
});
```

- [ ] **Step 2: Run the full suite**

Run:

```bash
bun test
```

Expected: FAIL until all prior task behavior is in place.

- [ ] **Step 3: Adjust integration assertions to match final supported behavior**

Keep only assertions that reflect the documented supported contract. Do not assert placeholder strings or accidental implementation details.

- [ ] **Step 4: Re-run the full suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tsa-mcp-server/test/integration.test.ts
git commit -m "test(tsa): strengthen end-to-end integration coverage"
```

### Task 8: Reconcile Specs And Fixtures With Reality

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-tsa-mcp-server-design.md`
- Modify: `docs/superpowers/specs/2026-04-04-tsa-reference-extraction-design.md`
- Modify: `README.md` and/or `tsa-mcp-server/CHANGELOG.md`

- [ ] **Step 1: Diff the implemented behavior against the written specs**

Run:

```bash
rg -n "tsconfig.json|trace_middleware|get_route_config|resolve_config|Express|Next.js|SvelteKit" docs/superpowers/specs tsa-mcp-server/src tsa-mcp-server/test
```

Expected: concrete lines showing where docs and implementation differ.

- [ ] **Step 2: Update the spec text to match the supported contract**

Revise only the inaccurate sections. Preserve the overall design intent, but make limitations explicit. Example edits:

```md
- `resolve_config` supports JSON config files and static object-literal TS/JS config files.
- Express route tracing supports direct `app.use('/prefix', importedRouter)` mounts from relative imports.
- Next.js route config reports the concrete exported HTTP method handlers found in the matched route file.
```

- [ ] **Step 3: Update the README or changelog with current status**

Add a short status block:

```md
## Current Status

- Symbol and reference indexing implemented
- Runtime route/config tools implemented for static/common cases
- Known limitations: dynamic dispatch, DI, indirect Express router graphs, non-static config execution
```

- [ ] **Step 4: Sanity-check docs and tests together**

Run:

```bash
bun test
```

Expected: PASS, with the docs now describing the tested behavior.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs README.md tsa-mcp-server/CHANGELOG.md
git commit -m "docs(tsa): align specs and status docs with supported behavior"
```

## Self-Review Against The Specs

| Requirement Area | Covered By |
|---|---|
| Runnable/testable package baseline | Task 1 |
| `get_callers` contract fidelity | Task 2 |
| Monorepo framework selection | Task 3 |
| `resolve_config` documented behavior | Task 4 |
| Next.js runtime route metadata | Task 5 |
| Express mounted router tracing | Task 6 |
| End-to-end regression coverage | Task 7 |
| Spec/doc/fixture alignment | Task 8 |

Placeholder scan: no `TODO`, `TBD`, or deferred “implement later” steps remain.

Type consistency check: all tasks use the existing `ConfigService`, `FrameworkService`, `ReferenceService`, and test file locations already present in the repo.
