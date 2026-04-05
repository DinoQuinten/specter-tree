import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Project, SyntaxKind, type ObjectLiteralExpression, type PropertyAssignment } from 'ts-morph';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';

interface ResolveConfigInput { config_key: string; }
interface ConfigChainEntry { source: string; value: string; }
interface ConfigResult {
  final_value: string;
  chain: ConfigChainEntry[];
  _meta: { query_ms: number; correlationId: string };
}

const CONFIG_CANDIDATES = [
  'vite.config.ts', 'vite.config.js',
  'drizzle.config.ts', 'drizzle.config.js',
  'tsconfig.json',
  'next.config.ts', 'next.config.js',
  'svelte.config.ts', 'svelte.config.js'
];

/**
 * @class ConfigService
 * @description Reads non-env config files via ts-morph AST to extract key values.
 * Does NOT execute config files. Does NOT read .env files — out of scope by design.
 */
export class ConfigService extends BaseService {
  private readonly projectRoot: string;
  private readonly project: Project;

  /** @param projectRoot Absolute path to the project root */
  constructor(projectRoot: string) {
    super('ConfigService');
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * Resolve a dot-notation key from config files in the project.
   * Searches vite.config.ts, drizzle.config.ts, tsconfig.json, etc. in priority order.
   * @param input resolve_config tool input
   * @returns ConfigResult or null if key not found
   * @example
   *   resolveConfig({ config_key: 'build.outDir' })
   *   // → { final_value: 'dist', chain: [{ source: 'vite.config.ts:3', value: 'dist' }] }
   */
  resolveConfig(input: ResolveConfigInput): ConfigResult | null {
    const start = Date.now();
    const keyParts = input.config_key.split('.');

    for (const candidate of CONFIG_CANDIDATES) {
      const filePath = join(this.projectRoot, candidate);
      if (!existsSync(filePath)) continue;
      try {
        const value = candidate.endsWith('.json')
          ? this.extractFromJsonFile(filePath, keyParts)
          : this.extractFromFile(filePath, keyParts);
        if (value !== null) {
          this.logDebug(LogEvents.TOOL_CALLED, { tool: 'resolve_config', key: input.config_key, file: candidate });
          return {
            final_value: value.value,
            chain: [{ source: `${candidate}:${value.line}`, value: value.value }],
            _meta: { query_ms: Date.now() - start, correlationId: randomUUID() }
          };
        }
      } catch { /* parsing failed — try next file */ }
    }
    return null;
  }

  private extractFromFile(filePath: string, keyParts: string[]): { value: string; line: number } | null {
    const existing = this.project.getSourceFile(filePath);
    if (existing) this.project.removeSourceFile(existing);
    const sourceFile = this.project.addSourceFileAtPath(filePath);

    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (!defaultExport) return null;

    for (const decl of defaultExport.getDeclarations()) {
      const obj = this.findObjectLiteral(decl);
      if (!obj) continue;
      const result = this.traverseObject(obj, keyParts, 0);
      if (result) return result;
    }
    return null;
  }

  private extractFromJsonFile(filePath: string, keyParts: string[]): { value: string; line: number } | null {
    const parsed = this.loadJsonConfig(filePath);
    const value = this.traverseJson(parsed, keyParts);
    if (value === undefined) return null;
    return { value: this.stringifyConfigValue(value), line: 1 };
  }

  private loadJsonConfig(filePath: string, visited: Set<string> = new Set()): Record<string, unknown> {
    if (visited.has(filePath)) return {};
    visited.add(filePath);

    const current = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const baseConfig = typeof current['extends'] === 'string'
      ? this.loadJsonConfig(this.resolveExtendedConfig(filePath, current['extends']), visited)
      : {};

    const merged = this.deepMerge(baseConfig, current);
    delete merged['extends'];
    return merged;
  }

  private resolveExtendedConfig(filePath: string, extendRef: string): string {
    if (extendRef.endsWith('.json')) return join(dirname(filePath), extendRef);
    return join(dirname(filePath), `${extendRef}.json`);
  }

  private traverseJson(current: unknown, keyParts: string[]): unknown {
    let value = current;
    for (const key of keyParts) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !(key in value)) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }

  private stringifyConfigValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  private deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      const existing = merged[key];
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        merged[key] = this.deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  private findObjectLiteral(node: unknown): ObjectLiteralExpression | null {
    const n = node as { getKindName?: () => string; getChildren?: () => unknown[] };
    if (n.getKindName?.() === 'ObjectLiteralExpression') return node as ObjectLiteralExpression;
    for (const child of n.getChildren?.() ?? []) {
      const found = this.findObjectLiteral(child);
      if (found) return found;
    }
    return null;
  }

  private traverseObject(obj: ObjectLiteralExpression, keyParts: string[], depth: number): { value: string; line: number } | null {
    if (depth >= keyParts.length) return null;
    const key = keyParts[depth]!;
    for (const prop of obj.getProperties()) {
      if (prop.getKindName() !== 'PropertyAssignment') continue;
      const pa = prop as PropertyAssignment;
      if (pa.getName() !== key) continue;
      if (depth === keyParts.length - 1) {
        return { value: pa.getInitializer()?.getText().replace(/['"]/g, '') ?? '', line: pa.getStartLineNumber() };
      }
      const nested = pa.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
      if (nested) return this.traverseObject(nested as ObjectLiteralExpression, keyParts, depth + 1);
    }
    return null;
  }
}
