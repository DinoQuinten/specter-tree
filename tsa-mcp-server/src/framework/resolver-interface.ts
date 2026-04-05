/**
 * @file resolver-interface.ts
 * @description Shared contract that all framework-specific route and middleware
 * resolvers must implement. FrameworkService delegates to this interface at runtime.
 * @module framework
 */
import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';

/**
 * @description Common interface for all framework-specific route and middleware resolvers.
 * Implementations exist for Express, Next.js, and SvelteKit.
 */
export interface IFrameworkResolver {
  /**
   * @description Traces the ordered middleware chain for a given route path.
   * @param routePath - URL path to trace (e.g. "/api/users").
   * @param method - Optional HTTP method filter applied by the resolver.
   * @returns Ordered list of middleware hops that run before the route handler.
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[];

  /**
   * @description Returns route configuration for a URL path, mapping it to a handler
   * file and location within the framework's routing conventions.
   * @param urlPath - URL path to resolve.
   * @returns RouteConfig with handler and file location, or null when not found.
   */
  getRouteConfig(urlPath: string): RouteConfig | null;
}
