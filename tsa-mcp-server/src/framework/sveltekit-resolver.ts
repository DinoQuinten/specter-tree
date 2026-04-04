import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class SvelteKitResolver
 * @description Resolves SvelteKit routes via file system conventions.
 * Maps URLs to +server.ts files and walks up for hooks.server.ts middleware.
 */
export class SvelteKitResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly routesDir: string;

  /** @param projectRoot Absolute path to the SvelteKit project root */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.routesDir = join(projectRoot, 'src', 'routes');
  }

  /**
   * Walk up directory tree collecting hooks.server.ts files.
   * @param routePath URL path
   */
  traceMiddleware(routePath: string, _method?: HttpMethod): MiddlewareTrace[] {
    const traces: MiddlewareTrace[] = [];
    const hooksRoot = join(this.projectRoot, 'src', 'hooks.server.ts');
    if (existsSync(hooksRoot)) {
      traces.push({ name: 'handle', file_path: hooksRoot, line: 1, order: 0 });
    }
    const routeFile = this.resolveRouteFile(routePath);
    if (routeFile) {
      let dir = dirname(routeFile);
      let order = 1;
      while (dir.startsWith(this.routesDir)) {
        const layout = join(dir, '+layout.server.ts');
        if (existsSync(layout)) {
          traces.push({ name: 'load', file_path: layout, line: 1, order: order++ });
        }
        dir = dirname(dir);
      }
    }
    return traces;
  }

  /**
   * Map URL path to +server.ts handler file.
   * @param urlPath URL path (e.g. "/users/123")
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    try {
      const routeFile = this.resolveRouteFile(urlPath);
      if (!routeFile) return null;
      return { handler: 'GET|POST|PUT|DELETE', file_path: routeFile, guards: [], redirects: [] };
    } catch (err) {
      throw new FrameworkError(`Failed to resolve SvelteKit route for ${urlPath}`, { cause: String(err) });
    }
  }

  private resolveRouteFile(urlPath: string): string | null {
    const segments = urlPath.replace(/^\//, '').split('/');
    const candidates: string[] = [];
    candidates.push(join(this.routesDir, ...segments, '+server.ts'));
    for (let i = 0; i < segments.length; i++) {
      const dynamic = [...segments];
      dynamic[i] = `[${segments[i]!}]`;
      candidates.push(join(this.routesDir, ...dynamic, '+server.ts'));
    }
    return candidates.find(c => existsSync(c)) ?? null;
  }
}
