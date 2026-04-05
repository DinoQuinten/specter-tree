/**
 * @file sveltekit-resolver.ts
 * @description IFrameworkResolver implementation for SvelteKit projects. Resolves routes
 * via file-system conventions, mapping URLs to +server.ts files and collecting
 * hooks.server.ts and +layout.server.ts middleware by walking the route tree.
 * @module framework
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @description Resolves SvelteKit routes and middleware using file-system conventions.
 * Maps URLs to +server.ts handler files and collects hooks.server.ts and
 * +layout.server.ts middleware hops by walking up the routes directory tree.
 * @class SvelteKitResolver
 * @example
 * const resolver = new SvelteKitResolver('/repo');
 * const config = resolver.getRouteConfig('/users/123');
 */
export class SvelteKitResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly routesDir: string;

  /**
   * @description Creates a SvelteKitResolver scoped to the given project root.
   * @param projectRoot - Absolute path to the SvelteKit project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.routesDir = join(projectRoot, 'src', 'routes');
  }

  /**
   * @description Traces middleware by collecting the global hooks.server.ts entry and
   * walking up the route directory tree for +layout.server.ts files.
   * @param routePath - URL path whose middleware chain should be traced.
   * @param _method - Unused; included for interface compatibility.
   * @returns Ordered middleware hops starting with global hooks and ascending layout files.
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
   * @description Maps a URL path to a +server.ts handler file using SvelteKit file-system
   * routing conventions.
   * @param urlPath - URL path to resolve (e.g. "/users/123").
   * @returns RouteConfig with the matched +server.ts file path, or null when not found.
   * @throws {FrameworkError} - When an unexpected error occurs during file-system resolution.
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

  /**
   * @description Generates candidate +server.ts paths for a URL path by trying static
   * and dynamic segment replacements, returning the first that exists on disk.
   * @param urlPath - URL path to resolve.
   * @returns Absolute path to the matching +server.ts file, or null when none is found.
   */
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
