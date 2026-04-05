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
 * Detect the project root using priority chain:
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
 * Validate and return typed ENV vars.
 * @returns Fully typed EnvVars object
 */
export function validateEnv(): EnvVars {
  const projectRoot = detectProjectRoot();
  const dbPath = process.env['TSA_DB_PATH'] || join(projectRoot, '.tsa', 'index.db');
  return {
    NODE_ENV: (process.env['NODE_ENV'] as 'development' | 'production') ?? 'development',
    LOG_LEVEL: (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    TSA_PROJECT_ROOT: projectRoot,
    TSA_DB_PATH: dbPath
  };
}
