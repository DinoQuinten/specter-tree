import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class NextJsResolver
 * @description Resolves Next.js routes using file system conventions.
 * Supports Pages Router (pages/) and App Router (app/) simultaneously.
 */
export class NextJsResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly hasPagesRouter: boolean;
  private readonly hasAppRouter: boolean;

  /** @param projectRoot Absolute path to the Next.js project root */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.hasPagesRouter = existsSync(join(projectRoot, 'pages'));
    this.hasAppRouter = existsSync(join(projectRoot, 'app'));
  }

  /**
   * Return middleware.ts if it exists.
   * @param routePath URL path
   */
  traceMiddleware(_routePath: string, _method?: HttpMethod): MiddlewareTrace[] {
    const middlewareFile = join(this.projectRoot, 'middleware.ts');
    if (!existsSync(middlewareFile)) return [];
    return [{ name: 'middleware', file_path: middlewareFile, line: 1, order: 0 }];
  }

  /**
   * Map URL to handler file using Next.js conventions. App Router first, then Pages.
   * @param urlPath URL path (e.g. "/api/users/123")
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

  private resolveAppRouter(urlPath: string): RouteConfig | null {
    const appDir = join(this.projectRoot, 'app');
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates = this.buildCandidates(appDir, segments, 'route.ts');
    const found = candidates.find(c => existsSync(c));
    if (!found) return null;
    return { handler: 'GET|POST|PUT|DELETE', file_path: found, guards: [], redirects: [] };
  }

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
