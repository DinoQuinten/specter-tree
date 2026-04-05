/**
 * @file FrameworkService.ts
 * @description Monorepo-aware framework detection and route/middleware delegation service.
 * Detects Express, Next.js, and SvelteKit sub-projects and routes queries to the
 * appropriate IFrameworkResolver at runtime.
 * @module services
 */
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

/**
 * @description Result envelope for trace_middleware containing the ordered trace list
 * and metadata about the matched framework.
 */
interface TraceResult {
  /** Ordered list of middleware hops for the requested route. */
  traces: MiddlewareTrace[];
  /** Timing, correlation, and detected framework metadata. */
  _meta: { query_ms: number; correlationId: string; framework: string };
}

/**
 * @description Monorepo-aware framework detection service. Builds a prefix-to-resolver
 * map at construction and delegates trace_middleware / get_route_config calls to the
 * matched IFrameworkResolver.
 * @class FrameworkService
 * @example
 * const frameworkService = new FrameworkService('/repo');
 * const result = frameworkService.traceMiddleware('/api/users');
 */
export class FrameworkService extends BaseService {
  private readonly resolverMap: Record<string, IFrameworkResolver> = {};
  private readonly projectRoot: string;

  /**
   * @description Creates a new FrameworkService and immediately scans the project root
   * for supported frameworks.
   * @param projectRoot - Absolute path to the project or monorepo root.
   */
  constructor(projectRoot: string) {
    super('FrameworkService');
    this.projectRoot = projectRoot;
    this.detectFrameworks();
  }

  /**
   * @description Returns a shallow copy of the internal prefix-to-resolver map.
   * Primarily used for testing resolver detection.
   * @returns Shallow copy of the resolver map keyed by path prefix.
   */
  getResolverMap(): Record<string, IFrameworkResolver> {
    return { ...this.resolverMap };
  }

  /**
   * @description Traces the ordered middleware chain for a route path by delegating to
   * the best-matching framework resolver.
   * @param routePath - URL path whose middleware chain should be traced (e.g. "/api/users").
   * @param method - Optional HTTP method filter passed through to the resolver.
   * @returns Trace result with ordered middleware hops and the matched framework name.
   * @throws {FrameworkError} - When the matched resolver fails to parse the application files.
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
   * @description Returns route configuration for a URL path by delegating to the
   * best-matching framework resolver.
   * @param urlPath - URL path to resolve (e.g. "/api/users/123").
   * @returns RouteConfig with handler and file location, or null when no resolver matches.
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    const [, resolver] = this.resolverFor(urlPath);
    if (!resolver) return null;
    return resolver.getRouteConfig(urlPath);
  }

  /**
   * @description Selects the best-matching resolver for a route path by finding the
   * longest registered prefix that the path starts with.
   * @param routePath - URL path to match against registered prefixes.
   * @returns Tuple of matched prefix and resolver, or ['.', null] when no resolver is registered.
   */
  private resolverFor(routePath: string): [string, IFrameworkResolver | null] {
    const prefixes = Object.keys(this.resolverMap).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      if (routePath.startsWith(prefix) || prefix === '.') {
        return [prefix, this.resolverMap[prefix]!];
      }
    }
    return ['.', null];
  }

  /**
   * @description Scans the project root for supported frameworks. Tries the root itself
   * first, then iterates immediate subdirectories for monorepo layouts.
   */
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

  /**
   * @description Attempts to detect a supported framework in a single directory and
   * registers a resolver for it when found.
   * @param dir - Absolute path to the directory to inspect.
   * @param prefix - Route prefix key to register in the resolver map.
   * @returns True when a framework was detected and a resolver was registered.
   */
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
