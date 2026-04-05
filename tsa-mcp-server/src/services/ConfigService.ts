/**
 * @file ConfigService.ts
 * @description Reads non-env config files (vite, drizzle, tsconfig, next, svelte) via ts-morph AST
 * to extract key values by dot-notation path. Does not execute config files and never reads .env files.
 * @module services
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Project, SyntaxKind, type ObjectLiteralExpression, type PropertyAssignment } from 'ts-morph';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';

/**
 * @description Input contract for the resolve_config tool.
 */
interface ResolveConfigInput {
  /** @description Dot-notation key path to look up (e.g. 'build.outDir'). */
  config_key: string;
}

/**
 * @description One step in the config resolution chain, recording the source location and value.
 */
interface ConfigChainEntry {
  /** @description Source file and line where the value was found (e.g. 'vite.config.ts:3'). */
  source: string;
  /** @description Resolved string representation of the value at this step. */
  value: string;
}

/**
 * @description Result returned by the resolve_config tool with the resolved value and its provenance chain.
 */
interface ConfigResult {
  /** @description Final resolved string value for the requested key. */
  final_value: string;
  /** @description Ordered list of resolution steps from config file to final value. */
  chain: ConfigChainEntry[];
  /** @description Request metadata including timing and correlation identifier. */
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
 * @example
 * const config = new ConfigService('/repo');
 * const result = config.resolveConfig({ config_key: 'build.outDir' });
 */
export class ConfigService extends BaseService {
  private readonly projectRoot: string;
  private readonly project: Project;

  /**
   * @description Creates a ConfigService for the given project root.
   * @param projectRoot - Absolute path to the project root directory.
   */
  constructor(projectRoot: string) {
    super('ConfigService');
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * @description Resolves a dot-notation key from project config files searched in priority order:
   * vite.config, drizzle.config, tsconfig.json, next.config, svelte.config.
   * @param input - resolve_config tool input carrying the key path.
   * @returns ConfigResult with final value and provenance chain, or null when not found.
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

  /**
   * @description Extracts a config value from a TypeScript/JavaScript config file using ts-morph.
   * Parses the default export, finds the root object literal, and traverses the key path.
   * @param filePath - Absolute path to the config file.
   * @param keyParts - Ordered key segments split from the dot-notation path.
   * @returns Resolved value with its line number, or null when not found.
   */
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

  /**
   * @description Extracts a config value from a JSON config file with extends-chain support.
   * Merges the inheritance chain before traversing the key path.
   * @param filePath - Absolute path to the JSON config file.
   * @param keyParts - Ordered key segments split from the dot-notation path.
   * @returns Resolved value (line always 1 for JSON), or null when not found.
   */
  private extractFromJsonFile(filePath: string, keyParts: string[]): { value: string; line: number } | null {
    const parsed = this.loadJsonConfig(filePath);
    const value = this.traverseJson(parsed, keyParts);
    if (value === undefined) return null;
    return { value: this.stringifyConfigValue(value), line: 1 };
  }

  /**
   * @description Loads and deep-merges a JSON config file, recursively resolving
   * the 'extends' chain. A visited set prevents infinite loops from circular references.
   * @param filePath - Absolute path to the JSON config to load.
   * @param visited - Set of already-visited paths used to detect cycles.
   * @returns Fully merged config object with the 'extends' key removed.
   */
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

  /**
   * @description Resolves the path referenced by a JSON 'extends' field relative to the
   * containing config file, appending '.json' when the reference lacks an extension.
   * @param filePath - Absolute path of the file containing the extends field.
   * @param extendRef - The raw extends value from the JSON config.
   * @returns Absolute path to the referenced config file.
   */
  private resolveExtendedConfig(filePath: string, extendRef: string): string {
    if (extendRef.endsWith('.json')) return join(dirname(filePath), extendRef);
    return join(dirname(filePath), `${extendRef}.json`);
  }

  /**
   * @description Traverses a plain object using an ordered key path to retrieve a nested value.
   * @param current - The root object to traverse.
   * @param keyParts - Ordered key segments representing the traversal path.
   * @returns The value at the resolved path, or undefined when any segment is absent.
   */
  private traverseJson(current: unknown, keyParts: string[]): unknown {
    let value = current;
    for (const key of keyParts) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !(key in value)) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }

  /**
   * @description Converts a config value to its string representation.
   * Primitives are converted with String(); complex values are JSON-serialized.
   * @param value - The config value to stringify.
   * @returns Human-readable string representation.
   */
  private stringifyConfigValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  /**
   * @description Deep-merges two plain objects, recursively combining nested objects.
   * Non-object values in override always replace base values.
   * @param base - The base object whose keys serve as defaults.
   * @param override - The override object whose keys take precedence.
   * @returns New merged object without mutating either input.
   */
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

  /**
   * @description Recursively searches a ts-morph AST node tree for the first ObjectLiteralExpression.
   * Used to locate the root config object within a default export declaration.
   * @param node - The root node to search from.
   * @returns The first ObjectLiteralExpression found, or null when none is present.
   */
  private findObjectLiteral(node: unknown): ObjectLiteralExpression | null {
    const n = node as { getKindName?: () => string; getChildren?: () => unknown[] };
    if (n.getKindName?.() === 'ObjectLiteralExpression') return node as ObjectLiteralExpression;
    for (const child of n.getChildren?.() ?? []) {
      const found = this.findObjectLiteral(child);
      if (found) return found;
    }
    return null;
  }

  /**
   * @description Recursively traverses a ts-morph ObjectLiteralExpression using the key path
   * to find the target PropertyAssignment and extract its initializer text.
   * @param obj - Current object literal node being inspected.
   * @param keyParts - Ordered key segments for the full traversal path.
   * @param depth - Current traversal depth (index into keyParts).
   * @returns Resolved value with its source line, or null when the key is not found.
   */
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
