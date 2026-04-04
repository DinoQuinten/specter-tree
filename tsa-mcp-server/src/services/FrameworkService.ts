import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService';
import { LogEvents } from '../logging/logEvents';
import { FrameworkError } from '../errors/FrameworkError';
import { ExpressResolver } from '../framework/express-resolver';
import { NextJsResolver } from '../framework/nextjs-resolver';
import { SvelteKitResolver } from '../framework/sveltekit-resolver';
import type { IFrameworkResolver } from '../framework/resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';

interface TraceResult {
  traces: MiddlewareTrace[];
  _meta: { query_ms: number; correlationId: string; framework: string };
}

/**
 * @class FrameworkService
 * @description Monorepo-aware framework detection. Builds a prefix→resolver map at construction.
 * Delegates trace_middleware / get_route_config to the matched IFrameworkResolver.
 */
export class FrameworkService extends BaseService {
  private readonly resolverMap: Record<string, IFrameworkResolver> = {};
  private readonly projectRoot: string;

  /** @param projectRoot Absolute path to the project or monorepo root */
  constructor(projectRoot: string) {
    super('FrameworkService');
    this.projectRoot = projectRoot;
    this.detectFrameworks();
  }

  /**
   * Get the resolver map (prefix → resolver). Used for testing.
   * @returns Shallow copy of the resolver map
   */
  getResolverMap(): Record<string, IFrameworkResolver> {
    return { ...this.resolverMap };
  }

  /**
   * Trace middleware for a route path using the matched framework resolver.
   * @param routePath URL path
   * @param method Optional HTTP method
   * @returns Trace result with framework info
   */
  traceMiddleware(routePath: string, method?: HttpMethod): TraceResult {
    const start = Date.now();
    const [prefix, resolver] = this.resolverFor(routePath);
    if (!resolver) {
      return { traces: [], _meta: { query_ms: 0, correlationId: randomUUID(), framework: 'unknown' } };
    }
    try {
      const traces = resolver.traceMiddleware(routePath, method);
      this.logInfo(LogEvents.FRAMEWORK_TRACED, { routePath, framework: prefix });
      return { traces, _meta: { query_ms: Date.now() - start, correlationId: randomUUID(), framework: prefix } };
    } catch (err) {
      throw new FrameworkError(`Middleware trace failed for ${routePath}`, { cause: String(err) });
    }
  }

  /**
   * Get route configuration for a URL path.
   * @param urlPath URL path to resolve
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    const [, resolver] = this.resolverFor(urlPath);
    if (!resolver) return null;
    return resolver.getRouteConfig(urlPath);
  }

  private resolverFor(routePath: string): [string, IFrameworkResolver | null] {
    const prefixes = Object.keys(this.resolverMap).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      if (routePath.startsWith(prefix) || prefix === '.') {
        return [prefix, this.resolverMap[prefix]!];
      }
    }
    return ['.', null];
  }

  private detectFrameworks(): void {
    if (this.detectAt(this.projectRoot, '.')) return;
    try {
      for (const entry of readdirSync(this.projectRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
        this.detectAt(join(this.projectRoot, entry.name), entry.name);
      }
    } catch { /* ignore scan errors */ }
  }

  private detectAt(dir: string, prefix: string): boolean {
    if (existsSync(join(dir, 'next.config.ts')) || existsSync(join(dir, 'next.config.js'))) {
      this.resolverMap[prefix] = new NextJsResolver(dir);
      this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'nextjs', prefix });
      return true;
    }
    if (existsSync(join(dir, 'svelte.config.ts')) || existsSync(join(dir, 'svelte.config.js'))) {
      this.resolverMap[prefix] = new SvelteKitResolver(dir);
      this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'sveltekit', prefix });
      return true;
    }
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf-8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        if (parsed.dependencies?.['express'] || parsed.devDependencies?.['express']) {
          this.resolverMap[prefix] = new ExpressResolver(dir);
          this.logInfo(LogEvents.FRAMEWORK_DETECTED, { framework: 'express', prefix });
          return true;
        }
      } catch { /* malformed package.json */ }
    }
    return false;
  }
}
