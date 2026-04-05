/**
 * @file index.ts
 * @description Process bootstrap for the TSA MCP server. It wires core services, starts
 * indexing and transport handling, and owns graceful shutdown cleanup.
 * @module services
 *
 * NOTE: This file is the application entry point (analogous to server.ts in production-code-standards §2).
 * It intentionally contains bootstrap logic rather than re-exports only.
 */
import pkg from '../package.json' with { type: 'json' };
import chalk from 'chalk';
import { validateEnv } from './types/env';
import { startServer } from './server';
import type { TsaServer } from './server';
import { logger } from './logging/logger';
import { logQueue } from './logging/logQueue';
import { LogEvents } from './logging/logEvents';
import { getQuickStartPrompt } from './prompt';
import { ProjectRuntime } from './runtime/ProjectRuntime';

const c = {
  brand:   chalk.hex('#a855f7'),   // purple — specter-tree brand
  dim:     chalk.gray,
  label:   chalk.cyan,
  value:   chalk.white,
  code:    chalk.hex('#f472b6'),   // pink — commands / code
  step:    chalk.bold.white,
  key:     chalk.yellow,
  success: chalk.green,
  muted:   chalk.dim,
};

// Box inner width (chars between ║ borders, excluding the border chars themselves)
const BOX_W = 49;

/** Pad plain text to BOX_W then wrap in styled ║ borders. */
function boxLine(plain: string, styled: string): string {
  const pad = ' '.repeat(Math.max(0, BOX_W - plain.length));
  return c.brand('  ║') + styled + pad + c.brand('║');
}

// Prompt is generated after env is resolved so real paths are embedded.
// Lazily initialised in main() and --prompt handler.
let QUICK_START_PROMPT = '';

function printSetupHelp(): void {
  const sep = c.dim('  ' + '─'.repeat(54));
  const out = [
    '',
    c.brand('  specter-tree') + c.dim(` v${pkg.version}`) + c.dim(' — setup guide'),
    sep,
    '',
    c.step('  1. Install'),
    `     ${c.code('git clone https://github.com/DinoQuinten/specter-tree.git')}`,
    `     ${c.code('cd specter-tree/tsa-mcp-server && bun install')}`,
    '',
    c.step('  2. Test locally'),
    `     ${c.code('bun run dev')}`,
    `     ${c.code('bun run dev --project /your/project')} ${c.muted('(advanced override)')}`,
    '',
    c.step('  3. Add to Claude Code') + c.muted('  (.mcp.json in project root)'),
    c.dim('     {'),
    c.dim('       "mcpServers": { "tsa": {'),
    `         ${c.dim('"command": "bun",')}`,
    `         ${c.dim('"args": ["run",')} ${c.code('"/path/to/tsa-mcp-server/src/index.ts"')}${c.dim(']')}`,
    c.dim('     }}}'),
    '',
    c.step('  4. Add to Cursor') + c.muted('  (~/.cursor/mcp.json — same shape, use "${workspaceFolder}")'),
    '',
    c.step('  Environment variables'),
    `    ${c.key('TSA_PROJECT_ROOT')}   ${c.dim('Project to index')} ${c.muted('(auto-detected from tsconfig.json)')}`,
    `    ${c.key('TSA_DB_PATH')}        ${c.dim('SQLite index path')} ${c.muted('(default: {root}/.tsa/index.db)')}`,
    `    ${c.key('LOG_LEVEL')}          ${c.dim('debug | info | warn | error')} ${c.muted('(default: info)')}`,
    `    ${c.key('NODE_ENV')}           ${c.dim('development | production')} ${c.muted('(default: development)')}`,
    '',
    sep,
    c.step('  Quick-start prompt') + c.muted('  — paste into Codex, Claude Code, or another MCP-capable coding agent'),
    sep,
    '',
    ...QUICK_START_PROMPT.split('\n').map(l => `  ${c.dim('│')} ${chalk.white(l)}`),
    '',
    sep,
    '',
  ];
  process.stderr.write(out.join('\n') + '\n');
}

function printStartupBanner(env: { TSA_PROJECT_ROOT: string; TSA_DB_PATH: string; NODE_ENV: string; LOG_LEVEL: string }): void {
  const ver = `v${pkg.version}`;
  const title    = `  specter-tree  ${ver}`;
  const subtitle = `  TypeScript AST codebase intelligence`;
  const out = [
    '',
    c.brand('  ╔' + '═'.repeat(BOX_W) + '╗'),
    boxLine(title,    '  ' + chalk.bold.white('specter-tree') + '  ' + c.dim(ver)),
    boxLine(subtitle, '  ' + c.dim('TypeScript AST codebase intelligence')),
    c.brand('  ╚' + '═'.repeat(BOX_W) + '╝'),
    '',
    `  ${c.label('Project root')}  ${c.value(env.TSA_PROJECT_ROOT)}`,
    `  ${c.label('Database    ')}  ${c.dim(env.TSA_DB_PATH)}`,
    `  ${c.label('Environment ')}  ${env.NODE_ENV === 'production' ? chalk.green(env.NODE_ENV) : c.dim(env.NODE_ENV)}`,
    `  ${c.label('Log level   ')}  ${c.dim(env.LOG_LEVEL)}`,
    '',
    `  ${c.muted('Default: ')}  ${c.code('set_project_root(<workspace>)')} ${c.muted('from the agent session')}`,
    `  ${c.muted('Override:')}  ${c.code('TSA_PROJECT_ROOT=/path bun run dev')}  ${c.muted('or')}  ${c.code('--project /path')}`,
    `  ${c.muted('Help:    ')}  ${c.code('bun run dev --help')}`,
    '',
    c.dim('  ' + '─'.repeat(54)),
    `  ${c.brand('Paste this into Codex, Claude Code, or another MCP-capable coding agent:')}`,
    c.dim('  ' + '─'.repeat(54)),
    '',
    ...QUICK_START_PROMPT.split('\n').map(l => `  ${c.dim('│')} ${l.startsWith('  ') ? c.muted(l) : l.match(/^[A-Z& ]+$/) ? c.label(l) : chalk.white(l)}`),
    '',
    c.dim('  ' + '─'.repeat(54)),
    '',
    `  ${c.success('●')} ${chalk.bold('Indexing project files')}${c.dim('…')}  ${c.muted('Ctrl+C to stop')}`,
    '',
  ];
  process.stderr.write(out.join('\n') + '\n');
}

async function main(): Promise<void> {
  const env = validateEnv();
  const runtime = new ProjectRuntime({
    initialProjectRoot: env.TSA_PROJECT_ROOT,
    dbPathOverride: process.env['TSA_DB_PATH']
  });
  const binding = await runtime.initialize();
  QUICK_START_PROMPT = getQuickStartPrompt(import.meta.filename, binding.project_root);
  printStartupBanner({
    ...env,
    TSA_PROJECT_ROOT: binding.project_root,
    TSA_DB_PATH: binding.db_path
  });

  let mcpServer: TsaServer | undefined;

  // Shutdown is coordinated through a single promise so cleanup happens in one place.
  let resolveShutdown!: () => void;
  const shutdownSignal = new Promise<void>(res => { resolveShutdown = res; });
  const onSignal = (): void => {
    logger.info({ event: LogEvents.SERVER_SHUTDOWN, reason: 'signal' });
    resolveShutdown();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    logger.info({ event: LogEvents.INDEXER_STARTED, projectRoot: runtime.getProjectRoot() });
    mcpServer = await startServer(runtime);

    await shutdownSignal;
  } finally {
    // Drain the MCP server before closing shared resources so in-flight responses do not race cleanup.
    await mcpServer?.drain();
    await mcpServer?.server.close();
    await logQueue.destroy();
    await runtime.shutdown();
    logger.info({ event: LogEvents.SERVER_SHUTDOWN, reason: 'cleanup done' });
  }
}

process.on('uncaughtException', (err) => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err), reason: 'uncaughtException' });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(reason), reason: 'unhandledRejection' });
  process.exit(1);
});

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const { detectProjectRoot } = await import('./types/env');
  QUICK_START_PROMPT = getQuickStartPrompt(import.meta.filename, detectProjectRoot());
  printSetupHelp();
  process.exit(0);
}

if (process.argv.includes('--prompt') || process.argv.includes('-p')) {
  const { detectProjectRoot } = await import('./types/env');
  const prompt = getQuickStartPrompt(import.meta.filename, detectProjectRoot());
  process.stdout.write(prompt + '\n');
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error({ event: LogEvents.SERVER_SHUTDOWN, error: String(err) });
    process.exit(1);
  });
