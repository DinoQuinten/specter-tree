/**
 * @file env.ts
 * @description Environment variable detection and validation helpers for TSA MCP server startup.
 * @module types
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';

const ENV_SCHEMA = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

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
 * @description Detects the project root using the following priority chain:
 * 1. `--project <path>` CLI argument
 * 2. `TSA_PROJECT_ROOT` environment variable
 * 3. Nearest `tsconfig.json` found by walking up from the current working directory
 * 4. Current working directory as last resort
 * @returns Resolved absolute project root path.
 */
export function detectProjectRoot(): string {
  const args = process.argv;
  const projectIdx = args.indexOf('--project');
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    return args[projectIdx + 1]!;
  }
  if (process.env['TSA_PROJECT_ROOT']) {
    return process.env['TSA_PROJECT_ROOT'];
  }
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/**
 * @description Validates environment variables against the expected schema and returns a
 * fully typed EnvVars object. Also derives `TSA_PROJECT_ROOT` and `TSA_DB_PATH` from
 * `detectProjectRoot` when not explicitly set.
 * @returns Fully typed and validated EnvVars object.
 * @throws {Error} - When required environment variables fail Zod schema validation.
 */
export function validateEnv(): EnvVars {
  const projectRoot = detectProjectRoot();
  const dbPath = process.env['TSA_DB_PATH'] || join(projectRoot, '.tsa', 'index.db');

  const parsed = ENV_SCHEMA.safeParse({
    NODE_ENV: process.env['NODE_ENV'],
    LOG_LEVEL: process.env['LOG_LEVEL'],
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }

  return {
    NODE_ENV: parsed.data.NODE_ENV,
    LOG_LEVEL: parsed.data.LOG_LEVEL,
    TSA_PROJECT_ROOT: projectRoot,
    TSA_DB_PATH: dbPath
  };
}
