import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IFrameworkResolver } from './resolver-interface';
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';
import { FrameworkError } from '../errors/FrameworkError';

/**
 * @class ExpressResolver
 * @description Resolves Express.js route/middleware via AST analysis of app.use() / router.get() chains.
 * Limitation: cannot resolve dynamically computed routes or middleware added via variables.
 */
export class ExpressResolver implements IFrameworkResolver {
  private readonly projectRoot: string;
  private readonly project: Project;

  /** @param projectRoot Absolute path to the Express project root */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  }

  /**
   * Trace middleware by parsing app.use() chains from the main app file.
   * @param routePath URL path
   * @param method Optional HTTP method
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
   * Get route config for an Express URL path.
   * @param urlPath URL path to resolve
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

  private findAppFile(): string | null {
    const candidates = ['src/app.ts', 'src/server.ts', 'app.ts', 'server.ts', 'src/index.ts', 'index.ts'];
    for (const c of candidates) {
      const full = join(this.projectRoot, c);
      if (existsSync(full)) return full;
    }
    return null;
  }
}
