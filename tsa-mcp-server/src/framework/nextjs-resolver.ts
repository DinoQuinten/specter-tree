/**
 * @file nextjs-resolver.ts
 * @description IFrameworkResolver implementation for Next.js projects. Resolves routes
 * using file-system conventions and supports Pages Router and App Router simultaneously.
 * @module framework
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @description Resolves Next.js routes and middleware using file-system conventions.
 * Supports Pages Router (pages/) and App Router (app/) simultaneously, preferring
 * App Router when both are present.
 * @class NextJsResolver
 * @example
 * const resolver = new NextJsResolver('/repo');
 * const config = resolver.getRouteConfig('/api/users/123');
 */
export class NextJsResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly hasPagesRouter: boolean;
  private readonly hasAppRouter: boolean;

  /**
   * @description Creates a NextJsResolver scoped to the given project root and detects
   * which router conventions are present.
   * @param projectRoot - Absolute path to the Next.js project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.hasPagesRouter = existsSync(join(projectRoot, 'pages'));
    this.hasAppRouter = existsSync(join(projectRoot, 'app'));
  }

  /**
   * @description Returns a middleware trace containing middleware.ts when it exists in
   * the project root.
   * @param _routePath - URL path (unused; Next.js middleware applies globally).
   * @param _method - Unused; included for interface compatibility.
   * @returns Single-entry trace for middleware.ts, or an empty array when absent.
   */
  traceMiddleware(_routePath: string, _method?: HttpMethod): MiddlewareTrace[] {
    const middlewareFile = join(this.projectRoot, 'middleware.ts');
    if (!existsSync(middlewareFile)) return [];
    return [{ name: 'middleware', file_path: middlewareFile, line: 1, order: 0 }];
  }

  /**
   * @description Maps a URL path to a handler file using Next.js file-system conventions.
   * Tries App Router first, then falls back to Pages Router.
   * @param urlPath - URL path to resolve (e.g. "/api/users/123").
   * @returns RouteConfig with the matched handler file path, or null when no file matches.
   * @throws {FrameworkError} - When an unexpected error occurs during file-system resolution.
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    try {
      if (this.hasAppRouter) {
        const result = this.resolveAppRouter(urlPath);
        if (result) return result;
      }
      if (this.hasPagesRouter) {
        const result = this.resolvePagesRouter(urlPath);
        if (result) return result;
      }
      return null;
    } catch (err) {
      throw new FrameworkError(`Failed to resolve Next.js route for ${urlPath}`, { cause: String(err) });
    }
  }

  /**
   * @description Resolves a URL path against the App Router directory (app/) by
   * generating static and dynamic segment candidates for route.ts.
   * @param urlPath - URL path to resolve.
   * @returns RouteConfig when a matching route.ts file exists, otherwise null.
   */
  private resolveAppRouter(urlPath: string): RouteConfig | null {
    const appDir = join(this.projectRoot, 'app');
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates = this.buildCandidates(appDir, segments, 'route.ts');
    const found = candidates.find(c => existsSync(c));
    if (!found) return null;
    return { handler: 'GET|POST|PUT|DELETE', file_path: found, guards: [], redirects: [] };
  }

  /**
   * @description Resolves a URL path against the Pages Router directory (pages/) by
   * generating index and named file candidates for both static and dynamic segments.
   * @param urlPath - URL path to resolve.
   * @returns RouteConfig when a matching .ts file exists, otherwise null.
   */
  private resolvePagesRouter(urlPath: string): RouteConfig | null {
    const pagesDir = join(this.projectRoot, 'pages');
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates = [
      ...this.buildCandidates(pagesDir, segments, 'index.ts'),
      ...this.buildCandidates(pagesDir, segments, '.ts')
    ];
    const found = candidates.find(c => existsSync(c));
    if (!found) return null;
    return { handler: 'default', file_path: found, guards: [], redirects: [] };
  }

  /**
   * @description Builds a list of candidate file paths for a URL path by generating one
   * static path and one path per dynamic segment replacement.
   * @param baseDir - Base router directory (app/ or pages/).
   * @param segments - URL path segments split on "/".
   * @param suffix - File name suffix to append (e.g. "route.ts" or "index.ts").
   * @returns Candidate absolute paths ordered static-first then dynamic.
   */
  private buildCandidates(baseDir: string, segments: string[], suffix: string): string[] {
    const paths: string[] = [];
    paths.push(join(baseDir, ...segments, suffix));
    for (let i = 0; i < segments.length; i++) {
      const dynamic = [...segments];
      dynamic[i] = `[${segments[i]}]`;
      paths.push(join(baseDir, ...dynamic, suffix));
    }
    return paths;
  }
}
