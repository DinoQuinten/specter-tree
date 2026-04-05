/**
 * @file express-resolver.ts
 * @description IFrameworkResolver implementation for Express.js projects. Uses ts-morph
 * AST analysis of app.use() and router method chains to resolve routes and middleware.
 * @module framework
 */
import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @description Resolves Express.js route and middleware definitions via AST analysis of
 * app.use() and router method chains. Cannot resolve dynamically computed routes or
 * middleware registered through variables.
 * @class ExpressResolver
 * @example
 * const resolver = new ExpressResolver('/repo');
 * const traces = resolver.traceMiddleware('/api/users');
 */
export class ExpressResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly project: Project;

  /**
   * @description Creates an ExpressResolver scoped to the given project root directory.
   * @param projectRoot - Absolute path to the Express project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * @description Traces middleware by parsing app.use() and router method call chains
   * from the detected main application file.
   * @param routePath - URL path whose middleware chain should be traced.
   * @param _method - Unused; included for interface compatibility.
   * @returns Ordered list of middleware hops matching the route path.
   * @throws {FrameworkError} - When the main app file cannot be parsed by ts-morph.
   */
  traceMiddleware(routePath: string, _method?: HttpMethod): MiddlewareTrace[] {
    const appFile = this.findAppFile();
    if (!appFile) return [];
    try {
      const sourceFile = this.project.getSourceFile(appFile) ?? this.project.addSourceFileAtPath(appFile);
      const traces: MiddlewareTrace[] = [];
      let order = 0;
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
        const expr = call.getExpression().getText();
        if (/\.(use|get|post|put|delete|patch)$/.test(expr)) {
          const args = call.getArguments();
          const firstArg = args[0]?.getText().replace(/['"]/g, '') ?? '';
          if (!firstArg || routePath.startsWith(firstArg) || firstArg === '*') {
            traces.push({
              name: args[args.length - 1]?.getText() ?? 'anonymous',
              file_path: appFile, line: call.getStartLineNumber(), order: order++
            });
          }
        }
      }
      return traces;
    } catch (err) {
      throw new FrameworkError(`Failed to trace Express middleware for ${routePath}`, { cause: String(err) });
    }
  }

  /**
   * @description Returns route configuration for an Express URL path by scanning the
   * main application file for exact-match router method calls.
   * @param urlPath - URL path to look up (must be an exact string literal match).
   * @returns RouteConfig with the matched handler text and file location, or null when not found.
   * @throws {FrameworkError} - When the main app file cannot be parsed by ts-morph.
   */
  getRouteConfig(urlPath: string): RouteConfig | null {
    const appFile = this.findAppFile();
    if (!appFile) return null;
    try {
      const sourceFile = this.project.getSourceFile(appFile) ?? this.project.addSourceFileAtPath(appFile);
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
        const expr = call.getExpression().getText();
        if (/\.(get|post|put|delete|patch)$/.test(expr)) {
          const args = call.getArguments();
          const path = args[0]?.getText().replace(/['"]/g, '');
          if (path && urlPath === path) {
            return { handler: args[args.length - 1]?.getText() ?? 'unknown', file_path: appFile, guards: [], redirects: [] };
          }
        }
      }
      return null;
    } catch (err) {
      throw new FrameworkError(`Failed to get Express route config for ${urlPath}`, { cause: String(err) });
    }
  }

  /**
   * @description Searches common entry-point locations for the Express application file.
   * @returns Absolute path to the first existing candidate, or null when none are found.
   */
  private findAppFile(): string | null {
    const candidates = ['src/app.ts', 'src/server.ts', 'app.ts', 'server.ts', 'src/index.ts', 'index.ts'];
    for (const c of candidates) {
      const full = join(this.projectRoot, c);
      if (existsSync(full)) return full;
    }
    return null;
  }
}
