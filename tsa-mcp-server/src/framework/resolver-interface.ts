import type { MiddlewareTrace, RouteConfig, HttpMethod } from '../types/common';

/**
 * @interface IFrameworkResolver
 * @description Common interface for all framework-specific route and middleware resolvers.
 */
export interface IFrameworkResolver {
  /**
   * Trace the middleware chain for a given route.
   * @param routePath URL path (e.g. "/api/users")
   * @param method Optional HTTP method filter
   */
  traceMiddleware(routePath: string, method?: HttpMethod): MiddlewareTrace[];

  /**
   * Get route configuration for a URL path.
   * @param urlPath URL path to resolve
   * @returns RouteConfig or null if not found
   */
  getRouteConfig(urlPath: string): RouteConfig | null;
}
