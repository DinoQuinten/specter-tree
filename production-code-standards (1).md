---
name: scale-mdt-code
description: Production code generation, modification, and service development enforcing folder structure, OOP principles, Winston logging with queue-based dispatch, Botpresso tracking, Claude Code agent hooks for mandatory comments with Praman (@) annotations, and strict git security. Use this skill whenever generating new code, modifying services, creating API endpoints, database schemas, utilities, or building features. Enforce max 600 lines per file, TypeScript class-based architecture, meaningful event logging through LogQueue, Botpresso integration, REST API standards, idempotency, soft deletes, API versioning, and Claude Code hooks that require self-explanatory inline comments and TSDoc Praman annotations on all classes, methods, interfaces, and types on first pass. Always follow hierarchical structure with /auth, /routes, /database, /services, /utils, /middleware, /logging, /errors, /tracking, /scripts. Enforce gitleaks pre-commit hooks and .env security. Use for Bun + TypeScript + SvelteKit + PostgreSQL + Drizzle stack. Also use for questions about ID strategy, secret management, git security, pagination, health checks, API versioning, concurrency, commenting standards, or any code review.
compatibility:
  - Bun runtime
  - TypeScript (100%, no implicit any)
  - SvelteKit
  - PostgreSQL + Drizzle ORM
  - Winston Logger with LogQueue
  - Botpresso Tracker SDK
  - Firebase Authentication
  - Husky + Gitleaks
---

# Scale MDT Code Skill

Production-grade code generation and review enforcing consistent patterns across all services. **Rules only.** Code examples are minimal and illustrative.

---

## 1. Core Principles

- **No Monolithic Files**: Max 600 lines of actual code per file. Break into smaller, focused classes.
- **Object-Oriented**: All services, controllers, utilities are class-based with encapsulation and inheritance.
- **Strict Folder Hierarchy**: See Section 2. Enforced, no exceptions.
- **Queue-Based Logging**: All logs go through a `LogQueue` class. Never write logs synchronously in request paths. See Section 5.
- **Meaningful Logging**: Winston with DEBUG, INFO, WARN, ERROR, FATAL. Every business event gets logged (API calls, DB ops, auth, mutations, limits).
- **Botpresso Tracking**: All services integrate SDK tracking. Server: direct custom events. Client: SDK auto-capture. See Section 14.
- **100% TypeScript**: No implicit `any`. All functions have explicit return types. All parameters have types.
- **ENV-Based Config**: All configuration from `.env`. No JSON config files. No hardcoded values. Sensible defaults provided.
- **REST API Standards**: HTTP verbs (GET, POST, PUT, DELETE), proper status codes, consistent response envelope (Section 10).
- **Git Security First**: Pre-commit hooks with `gitleaks` block all secret commits. `.gitignore` enforced. See Section 6.
- **Mandatory Comments & Praman Annotations (Agent Hook)**: Claude Code and Cursor must automatically add self-explanatory comments and TSDoc Praman annotations (`@param`, `@returns`, `@throws`, `@example`) on every file creation, class/method creation, and code modification. Uncommented code is an incomplete deliverable. See Section 19.

---

## 2. Folder Structure (Enforced)

```
project/
├── src/
│   ├── server.ts                    # Entry point (minimal, delegates to app)
│   ├── app.ts                       # App init: middleware, routes, error handler
│   ├── auth/
│   │   ├── firebaseAuth.ts
│   │   ├── authMiddleware.ts
│   │   ├── guardMiddleware.ts
│   │   ├── authService.ts
│   │   ├── types.ts
│   │   └── constants.ts
│   ├── routes/
│   │   ├── v1/
│   │   │   ├── [domain]/
│   │   │   │   ├── [domain].routes.ts
│   │   │   │   ├── [domain]Controller.ts
│   │   │   │   └── types.ts
│   │   │   └── index.ts
│   │   ├── health.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── BaseService.ts
│   │   └── [Domain]Service.ts
│   ├── database/
│   │   ├── schema.ts
│   │   ├── client.ts
│   │   ├── migrations/
│   │   │   ├── 0001_initial.sql
│   │   │   └── 0002_add_feature.sql
│   │   ├── seeds/
│   │   │   ├── seedUsers.ts
│   │   │   └── seed.ts
│   │   └── types.ts
│   ├── middleware/
│   │   ├── errorHandler.ts
│   │   ├── requestLogger.ts
│   │   ├── rateLimiter.ts
│   │   ├── cors.ts
│   │   ├── validation.ts
│   │   └── types.ts
│   ├── utils/
│   │   ├── validators.ts
│   │   ├── dateHelpers.ts
│   │   ├── stringHelpers.ts
│   │   └── types.ts
│   ├── logging/
│   │   ├── logger.ts
│   │   ├── logQueue.ts
│   │   ├── logEvents.ts
│   │   ├── config.ts
│   │   └── types.ts
│   ├── tracking/
│   │   ├── trackerService.ts
│   │   ├── types.ts
│   │   └── constants.ts
│   ├── errors/
│   │   ├── ApiError.ts
│   │   ├── ValidationError.ts
│   │   ├── AuthError.ts
│   │   ├── NotFoundError.ts
│   │   ├── ConflictError.ts
│   │   ├── RateLimitError.ts
│   │   └── types.ts
│   ├── scripts/
│   │   ├── migrate.ts
│   │   ├── seed.ts
│   │   ├── healthCheck.ts
│   │   └── cleanup.ts
│   └── types/
│       ├── common.ts
│       ├── env.ts
│       └── errorCodes.ts
├── .env.example
├── .gitignore
├── .husky/
│   └── pre-commit
├── CHANGELOG.md
├── package.json
├── tsconfig.json
└── bun.lockb
```

**Rules:**
- One domain entity per route folder and per service class.
- `types.ts` lives alongside the module that owns those types. No orphan type files.
- `index.ts` files only re-export. Zero logic inside index files.
- Scripts in `src/scripts/` are utility runners (migrations, seeds, cleanup tasks). Not part of the HTTP API.

---

## 3. ID Generation Rules

**Primary Key Strategy:**

| Scenario | PK Column | Type | Rule |
|---|---|---|---|
| Entity has a unique email | `email` | `varchar(255)` | Use email as PK. No separate `id` needed. |
| Entity has no natural key | `id` | `text` | Generate using `cuid2`. App-layer generation via Drizzle `$defaultFn`. |
| External system owns ID | `external_id` | `text` | Store their ID as PK. Add `source` column. |

**Rules:**
- If an entity has an email field that is guaranteed unique, use email as the primary key. Never create a synthetic ID alongside it.
- For entities without a natural key, use `cuid2` via `@paralleldrive/cuid2`. Generate at the application layer (in Drizzle `$defaultFn`), not at the database layer.
- Never use auto-increment integers as PKs. They leak record counts, create enumeration risks, and cause issues in distributed setups.
- Foreign keys reference whatever the parent's PK is (email or cuid).
- All IDs are case-sensitive. Never apply `.toLowerCase()` on cuid-based IDs.
- For email-based PKs, always normalize to lowercase before insert or query. Apply `.toLowerCase().trim()` at the service layer.

**Example:**
```typescript
// Email as PK
export const users = pgTable('users', {
  email: varchar('email', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

// CUID as PK
export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});
```

---

## 4. Coordination & Concurrency

**Rules:**
- Every mutation endpoint (POST, PUT, DELETE) must be idempotent. Use an `Idempotency-Key` header for non-naturally-idempotent operations. Store processed keys in Redis with a TTL of 24 hours. If the same key is seen again within the TTL, return the cached response without re-executing.
- For concurrent updates on the same record, use optimistic concurrency: add an `updatedAt` timestamp check. If the record's `updatedAt` has changed since the client last fetched it, reject with `409 Conflict` and include the current version in the error response.
- Database writes spanning multiple tables must use a Drizzle transaction (`db.transaction()`). Never rely on sequential individual queries for multi-table mutations.
- For long-running operations (report generation, bulk imports), push to a job queue. Return `202 Accepted` with a job ID. Provide a `GET /jobs/:id` polling endpoint to check status.

---

## 5. Logging Rules

**All logs go through a queue. Never write logs synchronously in the request path.**

**LogQueue Implementation:**

```typescript
// src/logging/logQueue.ts
export class LogQueue {
  private queue: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private flushThreshold = 50;

  constructor(private flushIntervalMs: number = 1000) {
    this.startFlushTimer();
  }

  push(entry: LogEntry): void {
    this.queue.push(entry);
    if (this.queue.length >= this.flushThreshold) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const toFlush = [...this.queue];
    this.queue = [];
    toFlush.forEach(entry => {
      // Dispatch to Winston logger
      logger.log({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
        service: entry.service,
        correlationId: entry.correlationId,
        ...entry.context
      });
    });
  }

  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flush();
  }
}
```

**Logging Rules:**
- Instantiate a `LogQueue` class that buffers log entries in memory and flushes to Winston transports on a configurable interval (default: 1 second) or when the buffer exceeds a threshold (default: 50 entries).
- Winston transports: Console (dev), File (prod: `app.log` + `error.log`), and optionally a remote transport (Datadog, Loki) configured via ENV.
- Every log entry must include: `timestamp`, `level`, `message`, `service` (class/module name), `correlationId` (request-scoped, passed via middleware), and context data.
- Use the `LogEvents` enum for all event names. No ad-hoc string event names.
- Log levels and when to use them:
  - `DEBUG`: Internal state, variable values, flow tracing. Dev only.
  - `INFO`: Business events (user created, order placed, job started).
  - `WARN`: Recoverable issues (rate limit approached, deprecated endpoint called, retry triggered).
  - `ERROR`: Failed operations needing attention (DB query failed, external API 5xx, auth provider down).
  - `FATAL`: Service cannot continue (DB connection lost, missing critical ENV var). Trigger graceful shutdown.
- All service classes extend `BaseService`, which provides `logInfo`, `logError`, `logDebug`, `logWarn` helpers. These push to the queue.

**Example BaseService:**
```typescript
// src/services/BaseService.ts
export abstract class BaseService {
  protected serviceName: string;

  constructor(name: string) {
    this.serviceName = name;
  }

  protected logInfo(message: string, data?: any): void {
    logQueue.push({
      level: 'info',
      message,
      service: this.serviceName,
      context: data
    });
  }

  protected logError(message: string, error: any, data?: any): void {
    logQueue.push({
      level: 'error',
      message,
      service: this.serviceName,
      context: { error: error.message, stack: error.stack, ...data }
    });
  }
}
```

---

## 6. Secret Management, Duplicate Code Detection & Git Security

**Rule: No secret must reach a commit. No duplicate code. No invalid commit messages. Enforce at multiple levels.**

### Level 1: Framework Init
- When initializing a project, run `bun init` (or equivalent). This generates baseline `.gitignore`.
- Verify `.gitignore` contains: `.env`, `.env.local`, `.env.*.local`, `logs/`, `node_modules/`, `bun.lockb` (if private), `*.pem`, `*.key`, `serviceAccountKey.json`.
- Add any missing entries before the first commit.

### Level 2: Husky Hook Installation
- Install `husky` and `gitleaks` as dev dependencies: `bun add -d husky gitleaks`.
- Install git hooks: `npx husky install` (creates `.husky/` folder).
- Create helper script `.husky/check-duplicates.sh` to scan for duplicate functions/classes.

### Level 3: Pre-Commit Hook (Secrets & Duplicate Code)
- Create `.husky/pre-commit` that:
  1. Scans staged files for secrets using `gitleaks protect --staged`.
  2. Checks for duplicate function/class names in the codebase.
  3. Blocks commit if secrets or duplicates are found.

**Pre-Commit Hook Script (`.husky/pre-commit`):**
```bash
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

**Duplicate Check Script (`.husky/check-duplicates.sh`):**
```bash
#!/bin/sh

# Get staged TypeScript/JavaScript files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

DUPLICATES_FOUND=0

for FILE in $STAGED_FILES; do
  # Extract function and class names from staged file
  FUNCTIONS=$(grep -oE '^(export\s+)?(async\s+)?function\s+[a-zA-Z_][a-zA-Z0-9_]*' "$FILE" | sed 's/.*function //g' || true)
  CLASSES=$(grep -oE '^(export\s+)?class\s+[a-zA-Z_][a-zA-Z0-9_]*' "$FILE" | sed 's/.*class //g' || true)

  # Check if any function/class already exists in src/ (excluding the current file)
  for FUNC in $FUNCTIONS; do
    if [ ! -z "$FUNC" ]; then
      COUNT=$(grep -r "function $FUNC\|const $FUNC = \|export const $FUNC" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | grep -v "$FILE" | wc -l)
      if [ "$COUNT" -gt 0 ]; then
        echo "⚠️  WARNING: Function '$FUNC' already exists in codebase."
        echo "   File: $FILE"
        echo "   Check src/ for existing definitions before duplicating."
        DUPLICATES_FOUND=1
      fi
    fi
  done

  for CLASS in $CLASSES; do
    if [ ! -z "$CLASS" ]; then
      COUNT=$(grep -r "class $CLASS" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" | grep -v "$FILE" | wc -l)
      if [ "$COUNT" -gt 0 ]; then
        echo "⚠️  WARNING: Class '$CLASS' already exists in codebase."
        echo "   File: $FILE"
        echo "   Check src/ for existing definitions before duplicating."
        DUPLICATES_FOUND=1
      fi
    fi
  done
done

if [ "$DUPLICATES_FOUND" -eq 1 ]; then
  echo ""
  echo "❌ Duplicate code detected. Please:"
  echo "   1. Search src/ for existing functions/classes with the same name."
  echo "   2. Refactor to reuse existing code or rename if intentional."
  echo "   3. Stage and commit again."
  exit 1
fi

exit 0
```

**Rules for Claude Code / Cursor Users:**
- Before committing, Claude must check if a function/class already exists in the codebase.
- When generating code, scan `src/` for existing functions/classes with the same name.
- If a duplicate is found, suggest refactoring to reuse the existing code instead of creating a duplicate.
- If a duplicate is intentional (e.g., overloading in a different context), add a comment: `// DUPLICATE_ALLOWED: reason` above the function/class.
- Never suggest creating a new function with a slightly different name to avoid the duplicate check (e.g., `getUserData` vs `getUserData2`). Always refactor or rename properly.

**Example Claude behavior:**
```
User: "Create a function to validate email addresses."

Claude (before creating):
1. Search codebase: grep -r "validateEmail" src/
2. Find existing in src/utils/validators.ts
3. Suggest: "I found validateEmail() already exists in src/utils/validators.ts. 
   Would you like me to refactor to use it, or do you need a different validation function?"

User: "Use the existing one."
Claude: "Done. Updated the code to import and use validateEmail from src/utils/validators.ts"
```

### Level 4: Pre-Push Hook (Tests & Linting)
- Create `.husky/pre-push` that runs tests and linting before pushing to remote.
- Prevents pushing code that fails tests or has linting errors.

**Pre-Push Hook Script (`.husky/pre-push`):**
```bash
#!/bin/sh

echo "🧪 Running tests..."
bun test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Push blocked."
  exit 1
fi

echo "🎨 Running linter..."
bun run lint
if [ $? -ne 0 ]; then
  echo "❌ Linting errors found. Push blocked."
  exit 1
fi

echo "✅ Pre-push checks passed."
exit 0
```

### Level 5: Commit-Msg Hook (Conventional Commits)
- Create `.husky/commit-msg` that enforces conventional commit format.
- Prevents commits with invalid messages.

**Commit-Msg Hook Script (`.husky/commit-msg`):**
```bash
#!/bin/sh

# Read the commit message
COMMIT_MSG=$(cat "$1")

# Conventional commit format: type(scope): subject
# Valid types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
# Example: feat(auth): add login validation

VALID_TYPES="feat|fix|docs|style|refactor|test|chore|perf|ci|build"
PATTERN="^($VALID_TYPES)(\([a-zA-Z0-9_-]+\))?: .{1,}$"

if ! echo "$COMMIT_MSG" | grep -E "$PATTERN" > /dev/null; then
  echo "❌ Invalid commit message format."
  echo ""
  echo "Use conventional commits:"
  echo "  feat(scope): description"
  echo "  fix(scope): description"
  echo "  docs(scope): description"
  echo "  test(scope): description"
  echo "  chore(scope): description"
  echo ""
  echo "Valid types: $VALID_TYPES"
  exit 1
fi

echo "✅ Commit message format is valid."
exit 0
```

### Level 6: Post-Merge Hook (Optional - Auto-Update)
- Create `.husky/post-merge` to auto-update dependencies after pulling changes.
- Useful for reminding about dependency and migration updates.

**Post-Merge Hook Script (`.husky/post-merge`):**
```bash
#!/bin/sh

# If package.json changed, remind user to run bun install
if git diff HEAD@{1} HEAD --name-only | grep -q "package.json"; then
  echo "📦 package.json changed. Run: bun install"
fi

# If migrations changed, remind user to run migrations
if git diff HEAD@{1} HEAD --name-only | grep -q "database/migrations"; then
  echo "🔄 Migrations changed. Run: bun src/scripts/migrate.ts"
fi

exit 0
```

### Level 7: .env Rules
- `.env` is never committed. Ever.
- `.env.example` is always committed. Documents every required variable with placeholder values.
- All ENV vars are typed in `src/types/env.ts`. The app validates all required ENV vars on startup and fails fast with a clear error if any are missing.

**Example .env validation:**
```typescript
// src/types/env.ts
export interface EnvVars {
  NODE_ENV: 'development' | 'production';
  PORT: number;
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
  TRACKER_TOOL_ID: string;
}

export function validateEnv(): EnvVars {
  const required = ['DATABASE_URL', 'FIREBASE_PROJECT_ID', 'TRACKER_TOOL_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing ENV vars: ${missing.join(', ')}`);
  }
  return {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    PORT: parseInt(process.env.PORT || '3000'),
    DATABASE_URL: process.env.DATABASE_URL!,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID!,
    TRACKER_TOOL_ID: process.env.TRACKER_TOOL_ID!
  };
}
```

---

## 7. Input Validation

**Rule: Validation strategy is determined by the developer per endpoint, but the pattern is enforced.**

- Every route accepting user input (POST, PUT, PATCH) must have a validation step before the controller calls the service.
- Validation is done in the `validation.ts` middleware or inline using Zod schemas in the route's `types.ts`.
- The developer chooses what to validate and how strict to be. This skill does not prescribe specific field rules.
- If validation fails, return `400 Bad Request` with a structured error body: `{ success: false, error: { code: "VALIDATION_ERROR", message: "...", fields: {...} } }`.

**Example validation middleware:**
```typescript
// src/middleware/validation.ts
import { z, ZodSchema } from 'zod';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../auth/authMiddleware';
import { ValidationError } from '../errors/ValidationError';

export function validateBody(schema: ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.validatedBody = validated;
      next();
    } catch (error: any) {
      const fields = error.errors.reduce((acc: any, err: any) => {
        acc[err.path.join('.')] = err.message;
        return acc;
      }, {});
      throw new ValidationError('Invalid input', { fields });
    }
  };
}
```

---

## 8. Testing (Placeholder)

Testing is not enforced in the current iteration. When it is added:

- Test files live alongside the module: `UserService.test.ts` next to `UserService.ts`.
- Use `bun:test` as the test runner.
- Minimum coverage targets will be defined per-service.
- Integration tests for API routes will use `supertest`.

**Skip generating tests unless explicitly requested.**

---

## 9. API Versioning Strategy

**Rule: URL-based versioning with sunset headers.**

- All routes are prefixed with `/api/v1/`, `/api/v2/`, etc.
- When a breaking change is needed (field removed, type changed, endpoint restructured), create a new version folder under `routes/`.
- The old version continues to work. Add a `Sunset` header to all responses from the deprecated version: `Sunset: <date>`. Add a `Deprecation: true` header.
- Both versions can share the same service layer. The controller in each version maps the version-specific request/response shape to the service interface.
- Non-breaking changes (new optional field, new endpoint) do not require a version bump. Add them to the current version.
- Maintain a `CHANGELOG.md` at the project root. Every version bump gets an entry: what changed, why, and the sunset date for the old version.
- After the sunset date passes and all clients have migrated (confirmed via tracking), remove the old version folder and its routes.

**Example CHANGELOG.md:**
```markdown
# Changelog

## [v2] - 2024-03-15

### Breaking Changes
- Removed `user.name` field from GET /users/:id. Use `user.fullName` instead.
- POST /orders now requires `idempotencyKey` header.

### New Features
- Added `deletedAt` to user soft deletes.
- New endpoint: GET /orders/:id/tracking.

### Sunset
- v1 deprecated. Sunset date: 2024-06-15. Migrate to v2 before then.

## [v1] - 2024-01-01

### Initial Release
- User CRUD endpoints.
- Order creation and status tracking.
```

---

## 10. Response Envelope

**Rule: Every API response follows a consistent shape.**

**Success (Single Entity):**
```json
{
  "success": true,
  "data": { "id": "user_123", "email": "test@example.com" }
}
```

**Success (Paginated List):**
```json
{
  "success": true,
  "data": [ { "id": "user_1" }, { "id": "user_2" } ],
  "meta": { "page": 1, "limit": 10, "total": 42 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "fields": { "email": "Required" }
  }
}
```

**Rules:**
- `success` is always present and is a boolean.
- `data` holds the payload on success. For single-resource endpoints, it is the entity object. For list endpoints, it is an array.
- `meta` is only present on paginated list endpoints. Include `page`, `limit`, and `total` (or `-1` if total is unknown).
- `error.code` is a machine-readable string constant. Define all codes in an `ErrorCodes` enum in `src/types/errorCodes.ts`.
- Controllers are responsible for shaping responses into this envelope. Services return raw data. Controllers wrap it.

**Example ErrorCodes:**
```typescript
// src/types/errorCodes.ts
export enum ErrorCodes {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}
```

---

## 11. Health Check & Startup Verification

**Rule: On service start, verify all dependencies before accepting traffic.**

**Startup Sequence:**
1. Validate all required ENV vars exist. Fail fast if any are missing.
2. Test PostgreSQL connection: run a simple `SELECT 1` query via Drizzle.
3. Test Redis connection (if used): run a `PING` command.
4. Test third-party service dependencies (Firebase auth, external APIs): make a lightweight call to verify connectivity.
5. Only after all checks pass, bind the HTTP server to the port.
6. If any check fails, log at `FATAL` level and exit with code 1. Do not accept requests.

**Health Endpoint (GET /health):**
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "up", "latencyMs": 12 },
    "redis": { "status": "up", "latencyMs": 3 },
    "firebase": { "status": "up" }
  },
  "uptime": 3600
}
```

Rules:
- If any dependency is down, `status` becomes `"degraded"` and the failing check shows `"status": "down"` with an error message.
- This endpoint does not require authentication.
- Include `uptime` in seconds since server start.

---

## 12. Pagination

**Rule: Offset-based pagination with fixed page sizes.**

- The client sends `page` (1-indexed) and `limit` as query parameters.
- `limit` is restricted to three values: `10`, `20`, or `50`. Any other value defaults to `10`.
- The response includes `meta` with `page`, `limit`, and `total` (total record count, or `-1` if expensive to compute).
- Services accept `page` and `limit`, compute `offset = (page - 1) * limit`, and pass to Drizzle query.
- For endpoints where total count is expensive, the service may return `total: -1` to indicate "unknown". The frontend hides the total count but still renders next/prev based on whether the returned array length equals `limit`.

**Example Service Method:**
```typescript
async listUsers(page: number = 1, limit: number = 10): Promise<{ users: User[], total: number }> {
  const restrictedLimit = [10, 20, 50].includes(limit) ? limit : 10;
  const offset = (page - 1) * restrictedLimit;

  const [users, countResult] = await Promise.all([
    db.select().from(users).offset(offset).limit(restrictedLimit),
    db.select({ count: count() }).from(users)
  ]);

  return { users, total: countResult[0].count };
}
```

---

## 13. Soft Deletes

**Rule: All user-facing entities support soft delete.**

- Add a `deletedAt` (`timestamp`, nullable, default `null`) column to every user-facing table.
- A "delete" operation sets `deletedAt = now()`. It does not remove the row.
- All list and get queries must filter `WHERE deletedAt IS NULL` by default.
- Provide an admin-only endpoint or flag (`?includeDeleted=true`) to query soft-deleted records.
- Hard deletes are only performed by scheduled cleanup scripts after a configurable retention period (default: 90 days). These scripts live in `src/scripts/cleanup.ts`.

**Example Schema:**
```typescript
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});
```

**Example Query:**
```typescript
async getUserById(id: string): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));
  return result.length ? result[0] : null;
}
```

---

## 14. Tracking Integration (Botpresso)

**Rules:**
- Server-side: Use `TrackerService` class. Call `trackerService.track(eventName, properties, token?)` for every business event (user created, order placed, subscription changed).
- Client-side: Botpresso SDK handles auto-capture (page views, clicks). No manual client tracking unless custom events are needed.
- Event naming convention: `domain.action` in lowercase. Examples: `user.created`, `order.placed`, `subscription.cancelled`.
- All tracking calls are fire-and-forget. A failed tracking call must never break the business flow. Wrap in try/catch, log the error, and move on.
- Tracker config comes from ENV: `TRACKER_TOOL_ID`, `TRACKER_API_KEY`, `TRACKER_URL`.

**Example TrackerService:**
```typescript
// src/tracking/trackerService.ts
export class TrackerService {
  private toolId: string;
  private apiKey: string;
  private trackerUrl: string;

  constructor() {
    this.toolId = process.env.TRACKER_TOOL_ID || '';
    this.apiKey = process.env.TRACKER_API_KEY || '';
    this.trackerUrl = process.env.TRACKER_URL || 'https://usagetracker.botpresso.com';
  }

  async track(eventName: string, properties?: any, token?: string): Promise<void> {
    if (!this.toolId) return;

    try {
      const event = {
        event: eventName,
        properties: properties || {},
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`${this.trackerUrl}/track/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(this.apiKey && { 'x-api-key': this.apiKey })
        },
        body: JSON.stringify({ toolId: this.toolId, events: [event] })
      });

      if (!response.ok) {
        logQueue.push({ level: 'warn', message: 'Tracking failed', context: { status: response.status } });
      }
    } catch (error) {
      logQueue.push({ level: 'error', message: 'Track error', context: { error } });
    }
  }
}

export const trackerService = new TrackerService();
```

---

## 15. Error Handling

**Rules:**
- Define custom error classes extending a base `ApiError`: `ValidationError (400)`, `AuthError (401)`, `ForbiddenError (403)`, `NotFoundError (404)`, `ConflictError (409)`, `RateLimitError (429)`.
- Services throw these errors. Controllers do not catch them individually.
- A centralized `errorHandler` middleware catches all errors:
  - If the error is an instance of `ApiError`, respond with its `statusCode` and wrapped in the response envelope.
  - If the error is unknown, respond with `500` and a generic message. Log the full stack trace at `ERROR` level.
- Never expose internal error details (stack traces, DB error messages) to the client in production.

**Example Error Classes:**
```typescript
// src/errors/ApiError.ts
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, fields?: Record<string, string>) {
    super(400, 'VALIDATION_ERROR', message, fields);
  }
}

export class AuthError extends ApiError {
  constructor(message: string) {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Rate limit exceeded') {
    super(429, 'RATE_LIMITED', message);
  }
}
```

**Example Error Handler:**
```typescript
// src/middleware/errorHandler.ts
export function errorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  if (error instanceof ApiError) {
    logQueue.push({
      level: 'warn',
      message: 'API error',
      context: { code: error.code, statusCode: error.statusCode }
    });
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message, fields: error.fields }
    });
  } else {
    logQueue.push({
      level: 'error',
      message: 'Unhandled error',
      context: { message: error.message, stack: error.stack }
    });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
```

---

## 16. Auth & Authorization

**Rules:**
- Firebase Authentication for identity verification. The `authMiddleware` extracts and verifies the Bearer token, attaches `{ uid, email, emailVerified }` to the request object.
- Role-based access uses a `guardMiddleware` that checks the user's role from the database against the allowed roles for the endpoint.
- Auth is applied at the route level, not the controller level. Routes opt in to auth via `router.use(authMiddleware)`.
- Public endpoints (health, login, register, webhooks) explicitly skip auth middleware.

**Example Auth Middleware:**
```typescript
// src/auth/authMiddleware.ts
export interface AuthRequest extends Request {
  user?: { uid: string; email: string; emailVerified: boolean };
  correlationId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new AuthError('Missing authorization token');

    const decoded = await firebaseAuthManager.verifyToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || '',
      emailVerified: decoded.email_verified || false
    };

    logQueue.push({
      level: 'debug',
      message: 'User authenticated',
      context: { uid: req.user.uid, correlationId: req.correlationId }
    });

    next();
  } catch (error) {
    throw new AuthError('Unauthorized');
  }
}
```

**Example Guard Middleware:**
```typescript
// src/auth/guardMiddleware.ts
export function roleGuard(allowedRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError('Not authenticated');

      const userRole = await fetchUserRole(req.user.uid);
      if (!allowedRoles.includes(userRole)) {
        logQueue.push({
          level: 'warn',
          message: 'Unauthorized access attempt',
          context: { uid: req.user.uid, required: allowedRoles }
        });
        throw new ForbiddenError('Insufficient permissions');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
```

---

## 17. Database Rules

**Rules:**
- Use Drizzle ORM with PostgreSQL. Schema defined in `src/database/schema.ts`.
- Every table must have: `createdAt (timestamp, defaultNow)` and `updatedAt (timestamp, defaultNow)`.
- Every user-facing table must have: `deletedAt (timestamp, nullable)` per Section 13.
- Use parameterized queries only. No string concatenation for query building.
- Migrations are versioned SQL files in `database/migrations/`. Named `0001_description.sql`, `0002_description.sql`, etc.
- Seeds are TypeScript files in `database/seeds/`. A master `seed.ts` runner calls them in order.
- The database client is a singleton exported from `database/client.ts`.
- Test database connections on startup (Section 11).

**Example Schema:**
```typescript
// src/database/schema.ts
import { pgTable, text, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('user'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});
```

**Example Database Client:**
```typescript
// src/database/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not defined');

const client = postgres(DATABASE_URL);
export const db = drizzle(client, { schema });

// Test connection on startup
client`SELECT 1`.then(() => {
  logQueue.push({ level: 'info', message: 'Database connected' });
}).catch((error) => {
  logQueue.push({ level: 'fatal', message: 'Database connection failed', context: { error } });
  process.exit(1);
});
```

---

## 18. Code Patterns (Reference Only)

These are minimal pattern templates showing shape, not implementation.

**Service method shape:**
```typescript
async doSomething(id: string): Promise<Result> {
  try {
    this.logInfo('Starting operation', { id });
    // Business logic here
    await trackerService.track('domain.action', { id });
    this.logInfo('Operation succeeded', { id });
    return result;
  } catch (error) {
    this.logError('Operation failed', error, { id });
    throw error;
  }
}
```

**Controller action shape:**
```typescript
async action(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await this.service.doSomething(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error); // Let errorHandler middleware handle it
  }
}
```

**Route definition shape:**
```typescript
const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.put('/:id', (req, res, next) => controller.update(req, res, next));
router.delete('/:id', (req, res, next) => controller.delete(req, res, next));

export default router;
```

---

## 19. Code Comments & Praman Annotations (Claude Code / Cursor Agent Hooks)

**Rule: This section defines mandatory behavioral hooks for Claude Code and Cursor. Whenever the coding agent generates new code, modifies existing code, or creates new files, the agent must automatically include self-explanatory comments and TSDoc Praman annotations as part of the output. These are not post-hoc additions. The agent must produce commented code on the first pass. Uncommented or under-commented code is an incomplete deliverable.**

**Agent Behavioral Hooks:**
- **On file creation**: The agent must add a file header comment (`@file`, `@description`, `@module`) as the first block before imports. See 19.4.
- **On class/interface/type/enum creation**: The agent must add a Praman block above the declaration with all required `@` tags for that member type. See 19.1.
- **On method/function creation or modification**: The agent must add a Praman block with `@description`, `@param` (each), `@returns`, and `@throws` (if applicable). See 19.1.
- **On any business logic**: The agent must add inline comments explaining the "why" behind conditionals, try/catch blocks, early returns, guard clauses, and complex queries. See 19.2.
- **On code review or refactor**: The agent must check for missing comments and Praman annotations and add them as part of the output.
- **On TODO/FIXME/HACK/WORKAROUND creation**: The agent must include author name and date (for TODO/FIXME) or issue reference (for HACK/WORKAROUND).

### 19.1 Praman Annotations (TSDoc `@` Tags)

Praman are the structured doc-comment blocks placed above classes, methods, interfaces, types, and enums using TSDoc `@` tags. Every public or exported member must carry a Praman block.

**Required Praman tags by member type:**

| Member Type | Required Tags | Optional Tags |
|---|---|---|
| Class | `@description`, `@example` | `@see`, `@deprecated` |
| Method (public) | `@description`, `@param` (each), `@returns`, `@throws` | `@example`, `@see`, `@deprecated` |
| Method (private/protected) | `@description`, `@param` (each), `@returns` | `@throws` |
| Interface / Type | `@description` | `@example`, `@see` |
| Enum | `@description` | `@example` |
| Exported Function | `@description`, `@param` (each), `@returns`, `@throws` | `@example`, `@see` |
| Exported Constant | `@description` | `@see` |

**Praman Rules:**
- `@description` is a concise one-liner explaining the purpose of the member. Not a restatement of the name.
- `@param` must include the parameter name and a brief description of what it represents, its constraints, and its default (if any). Format: `@param paramName - Description. Defaults to X.`
- `@returns` describes what the method returns and under what conditions. Not just the type.
- `@throws` lists each custom error class that can be thrown and the condition that triggers it. Format: `@throws {ErrorClass} - When condition.`
- `@example` provides a minimal usage snippet showing the call and expected outcome.
- `@see` links to related classes, methods, or external docs when cross-referencing is helpful.
- `@deprecated` includes the version or date of deprecation and what to use instead. Format: `@deprecated Since v2 - Use newMethod() instead.`
- Praman blocks use `/** ... */` syntax. Never `//` for Praman.

**Example Praman on a Service Method:**
```typescript
/**
 * @description Retrieves a user by their unique ID, excluding soft-deleted records.
 * @param id - The cuid2 identifier of the user to fetch.
 * @returns The user object if found, or null if no active user matches the ID.
 * @throws {NotFoundError} - When no user exists with the given ID.
 * @example
 * const user = await userService.getUserById('clh1abc23000008l6');
 */
async getUserById(id: string): Promise<User | null> {
  // ...
}
```

**Example Praman on a Class:**
```typescript
/**
 * @description Handles all user-related business logic including CRUD operations,
 * role management, and soft-delete workflows.
 * @example
 * const userService = new UserService();
 * const user = await userService.create({ email: 'test@example.com', name: 'Test' });
 */
export class UserService extends BaseService {
  // ...
}
```

**Example Praman on an Interface:**
```typescript
/**
 * @description Shape of the authenticated request object after authMiddleware
 * attaches the decoded Firebase token payload.
 */
export interface AuthRequest extends Request {
  /** @description Decoded user identity from Firebase token verification. */
  user?: { uid: string; email: string; emailVerified: boolean };
  /** @description Request-scoped unique identifier for log correlation. */
  correlationId?: string;
}
```

**Example Praman on an Enum:**
```typescript
/**
 * @description Canonical event names used across all logging calls.
 * Every log entry references one of these values. No ad-hoc strings.
 * @example
 * logQueue.push({ level: 'info', message: LogEvents.USER_CREATED, context: { userId } });
 */
export enum LogEvents {
  /** @description Fired when a new user account is successfully created. */
  USER_CREATED = 'user.created',
  /** @description Fired when a user account is soft-deleted. */
  USER_DELETED = 'user.deleted',
  /** @description Fired when an authentication attempt fails. */
  AUTH_FAILED = 'auth.failed'
}
```

**Example Praman on an Exported Constant:**
```typescript
/**
 * @description Allowed page sizes for paginated list endpoints.
 * Any client-supplied limit not in this set defaults to the first value.
 * @see Section 12 (Pagination)
 */
export const ALLOWED_PAGE_SIZES = [10, 20, 50] as const;
```

### 19.2 Inline Comments (Self-Explanatory)

Inline comments explain the reasoning, intent, edge cases, and non-obvious decisions within the code body. They answer "why is this here?" not "what does this line do?"

**Inline Comment Rules:**
- Place a comment above any block that handles an edge case, a workaround, a business rule, or a non-trivial decision.
- Use `//` for single-line inline comments. Use `/* ... */` only for multi-line explanations within a function body.
- Never comment obvious code. `// increment counter` above `counter++` is noise.
- Every `try/catch` block must have a comment explaining what error scenario is being handled and why the chosen recovery strategy was picked.
- Every conditional that encodes a business rule must have a comment stating the rule in plain language.
- Every early return or guard clause must have a comment explaining why execution stops.
- Database queries with joins, subqueries, or complex `WHERE` clauses must have a comment explaining the query's purpose.
- Any `TODO` or `FIXME` must include the author's name and a date. Format: `// TODO(author, 2024-03-15): description`.
- Any `HACK` or `WORKAROUND` must include a reference to the issue or the reason. Format: `// WORKAROUND: Firebase SDK does not support X, manual token refresh needed.`

**Example Inline Comments:**
```typescript
async createUser(data: CreateUserDto): Promise<User> {
  // Normalize email to lowercase to prevent duplicate accounts with mixed casing
  const normalizedEmail = data.email.toLowerCase().trim();

  // Check for existing user before insert to return a clear conflict error
  // instead of relying on the database unique constraint exception
  const existing = await this.findByEmail(normalizedEmail);
  if (existing) {
    // Active user with this email already exists, reject the creation
    throw new ConflictError(`User with email ${normalizedEmail} already exists`);
  }

  try {
    const user = await db.insert(users).values({
      email: normalizedEmail,
      name: data.name,
      role: data.role || 'user' // Default role assigned when client omits it
    }).returning();

    // Fire tracking event after successful persistence, not before
    await trackerService.track('user.created', { email: normalizedEmail });

    this.logInfo(LogEvents.USER_CREATED, { email: normalizedEmail });
    return user[0];
  } catch (error) {
    // Catch DB-level failures (connection lost, constraint violations not caught above)
    // and wrap them so the error handler returns a clean 500 instead of leaking internals
    this.logError('User creation failed at DB layer', error, { email: normalizedEmail });
    throw error;
  }
}
```

### 19.3 Section & Region Comments

For files that group related logic (e.g., a service class with multiple method categories), use region comments to visually separate sections.

**Region Comment Format:**
```typescript
// ──────────────────────────────────────────────
// SECTION: User CRUD Operations
// ──────────────────────────────────────────────

// ... methods ...

// ──────────────────────────────────────────────
// SECTION: Role Management
// ──────────────────────────────────────────────

// ... methods ...
```

**Rules:**
- Region comments are optional but recommended for service classes with 5+ methods.
- Use the exact format above. No other decorative styles.
- The section label must be descriptive and uppercase after `SECTION:`.

### 19.4 File Header Comments

Every source file must begin with a brief file header comment explaining the file's responsibility.

**File Header Format:**
```typescript
/**
 * @file UserService.ts
 * @description Handles all user-related business logic including CRUD,
 * role assignment, and soft-delete lifecycle management.
 * @module services
 */
```

**Rules:**
- `@file` is the filename.
- `@description` is a one or two line summary of the file's purpose.
- `@module` is the folder/module the file belongs to (`services`, `routes`, `middleware`, `auth`, `logging`, `tracking`, `errors`, `database`, `utils`, `scripts`, `types`).
- File header is the first thing in the file, before all imports.

---

## 20. Code Review Checklist

When reviewing or generating code, verify:

**Structure**
- No file exceeds 600 lines of actual code.
- Folder hierarchy is followed exactly.
- One domain entity per service class.
- `index.ts` files contain only re-exports.

**OOP**
- No god objects or mixed concerns.
- Single responsibility principle followed.
- Services extend `BaseService`.
- Private/protected members used correctly.

**Logging**
- Every business event is logged (creation, mutation, auth, API calls).
- All logs go through `LogQueue`, never written synchronously in request path.
- `LogEvents` enum used for all event names.
- Context includes `correlationId`, `userId`, `resourceId`, `timestamp`.
- No hardcoded log strings; all use `LogEvents` enum.

**Tracking**
- `trackerService.track()` called for all business events.
- Fire-and-forget pattern (never blocks response).
- Event names use `domain.action` format.

**TypeScript**
- No implicit `any`.
- All functions have explicit return types.
- All parameters have explicit types.
- Custom types defined in `types.ts` files.

**Configuration**
- All configuration from `process.env`.
- `.env.example` is up to date and committed.
- ENV validated on startup with `validateEnv()`.
- Sensible defaults provided.

**Errors**
- Custom error classes used (not generic `Error`).
- Error middleware catches all errors.
- No stack traces in client responses (production).
- Response envelope follows Section 10.
- Error codes use `ErrorCodes` enum.

**Database**
- Drizzle schema properly typed.
- Parameterized queries only (no string concat).
- All tables have `createdAt`, `updatedAt`.
- All user-facing tables have `deletedAt`.
- Migrations versioned in `database/migrations/`.
- Foreign keys reference correct PK type (email or cuid).

**Routes & Controllers**
- Controllers delegate to services (thin handlers).
- REST conventions followed (GET, POST, PUT, DELETE).
- Proper HTTP status codes (200, 201, 400, 401, 404, 409, 500).
- Auth middleware applied where required.
- Response shape follows Section 10 envelope.

**Git Security & Hooks**
- `.gitignore` covers all sensitive patterns (.env, *.key, logs/, etc.).
- Pre-commit hook with `gitleaks` is installed and active.
- Pre-commit hook with duplicate code detection is installed and active.
- Pre-push hook with tests/linting is installed and active.
- Commit-msg hook with conventional commit validation is installed and active.
- Post-merge hook with dependency reminders is installed (optional but recommended).
- No secrets in any staged files.
- `.env.example` has no real values, only placeholders.
- All commit messages follow conventional commit format (type(scope): message).

**Duplicate Code Detection**
- Claude/Cursor checks for existing functions/classes before creating new ones.
- When a duplicate is detected, Claude suggests refactoring to reuse existing code.
- No function/class names differ only slightly (e.g., `getUserData` vs `getUserData2`).
- All refactoring points to existing implementations in src/ with proper imports.

**Comments & Praman Annotations (Agent Hook Verification)**
- Every file starts with a `@file` / `@description` / `@module` header comment.
- Every exported class, method, interface, type, enum, function, and constant has a TSDoc Praman block (`/** ... */`).
- Praman blocks include all required tags for the member type (see Section 19.1 table).
- `@param` entries include name, description, and default value (if any).
- `@returns` describes what is returned and under what conditions.
- `@throws` lists each custom error class and its trigger condition.
- Inline comments explain "why", not "what". No obvious-code comments.
- Every `try/catch`, business-rule conditional, early return, and complex query has an inline comment.
- `TODO`/`FIXME` comments include author name and date.
- `HACK`/`WORKAROUND` comments include issue reference or reason.
- Region comments (`// SECTION:`) used for service classes with 5+ methods.
- Agent produced all comments on first pass, not as a separate follow-up step.

**Concurrency**
- Mutation endpoints use `Idempotency-Key` header where appropriate.
- Optimistic concurrency checks `updatedAt` for conflicts.
- Multi-table mutations use `db.transaction()`.
- Long-running ops return `202 Accepted` with job ID.

**Pagination**
- `limit` restricted to [10, 20, 50].
- `meta` block present on list responses.
- `page` is 1-indexed.
- Total count present (or `-1` if unknown).

**Health & Startup**
- All required ENV vars validated on startup.
- Database connection tested on startup.
- Redis connection tested (if used).
- Third-party dependencies verified.
- Health endpoint (GET /health) returns dependency status.

**API Versioning**
- Routes prefixed with `/api/v1/`, `/api/v2/`, etc.
- Deprecated versions include `Sunset` and `Deprecation` headers.
- `CHANGELOG.md` updated with every version bump.

---

## Environment Variables (.env.example)

```bash
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
LOG_QUEUE_FLUSH_MS=1000
LOG_QUEUE_THRESHOLD=50

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/database_name

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY="your-private-key"

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Tracker (Botpresso)
TRACKER_TOOL_ID=your-tool-id
TRACKER_API_KEY=your-api-key
TRACKER_URL=https://usagetracker.botpresso.com

# Redis (optional, for idempotency)
REDIS_URL=redis://localhost:6379

# Features
ENABLE_RATE_LIMITING=true
ENABLE_TRACKING=true
SOFT_DELETE_RETENTION_DAYS=90
```

---

## Quick Start Checklist for New Projects

- [ ] Run `bun init` and verify `.gitignore`.
- [ ] Add missing entries to `.gitignore` (.env, *.key, logs/, etc.).
- [ ] Install `husky` and `gitleaks`: `bun add -d husky gitleaks`.
- [ ] Run `npx husky install` to initialize git hooks directory.
- [ ] Create `.husky/pre-commit` with gitleaks + duplicate check.
- [ ] Create `.husky/check-duplicates.sh` helper script.
- [ ] Create `.husky/pre-push` with tests/linting validation.
- [ ] Create `.husky/commit-msg` with conventional commit enforcement.
- [ ] Create `.husky/post-merge` with dependency/migration reminders (optional).
- [ ] Create `.env.example` with all required variables.
- [ ] Create `src/types/env.ts` with `validateEnv()` function.
- [ ] Call `validateEnv()` in `src/server.ts` before starting the app.
- [ ] Initialize database client in `src/database/client.ts` with startup connection test.
- [ ] Create first folder structure: `/auth`, `/routes`, `/services`, `/database`, `/middleware`, `/utils`, `/logging`, `/errors`, `/tracking`.
- [ ] Implement `LogQueue` in `src/logging/logQueue.ts`.
- [ ] Implement `BaseService` in `src/services/BaseService.ts`.
- [ ] Create `src/app.ts` with middleware chain and error handler.
- [ ] Set up first route with thin controller that delegates to service.
- [ ] Verify logs go through queue, not synchronously.
- [ ] Test health endpoint returns dependency status.
- [ ] Test pre-commit hook blocks commits with secrets.
- [ ] Test pre-commit hook detects duplicate function/class names.
- [ ] Test pre-push hook blocks pushes with failing tests.
- [ ] Test commit-msg hook blocks invalid commit messages.
- [ ] Commit once all checks pass with valid conventional commit message.