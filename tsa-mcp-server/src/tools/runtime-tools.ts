import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FrameworkService } from '../services/FrameworkService';
import type { ConfigService } from '../services/ConfigService';

const TraceMiddlewareSchema = z.object({
  route_path: z.string().min(1),
  method: z.enum(['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD']).optional()
});

const GetRouteConfigSchema = z.object({
  url_path: z.string().min(1)
});

const ResolveConfigSchema = z.object({
  config_key: z.string().min(1)
});

export const RUNTIME_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'trace_middleware',
    description: 'Trace the middleware chain for a route path. Supports Express (app.use), Next.js (middleware.ts), and SvelteKit (hooks.server.ts + layout files).',
    inputSchema: {
      type: 'object',
      properties: {
        route_path: { type: 'string', description: 'URL path to trace (e.g. /api/users)' },
        method: { type: 'string', description: 'Optional HTTP method (GET, POST, etc.)' }
      },
      required: ['route_path']
    }
  },
  {
    name: 'get_route_config',
    description: 'Resolve a URL path to its handler file using framework file conventions.',
    inputSchema: {
      type: 'object',
      properties: {
        url_path: { type: 'string', description: 'URL path to resolve (e.g. /api/users/123)' }
      },
      required: ['url_path']
    }
  },
  {
    name: 'resolve_config',
    description: 'Read a dot-notation config key from project config files (vite.config.ts, drizzle.config.ts, tsconfig.json, etc.). Does NOT read .env files.',
    inputSchema: {
      type: 'object',
      properties: {
        config_key: { type: 'string', description: 'Dot-notation key (e.g. build.outDir, db.host)' }
      },
      required: ['config_key']
    }
  }
];

/**
 * @function handleRuntimeTool
 * @description Dispatch runtime tool calls to FrameworkService/ConfigService after Zod validation.
 */
export function handleRuntimeTool(
  toolName: string,
  rawInput: unknown,
  frameworkService: FrameworkService,
  configService: ConfigService
): unknown {
  if (!frameworkService) throw new Error('FrameworkService is not available');
  if (!configService) throw new Error('ConfigService is not available');
  switch (toolName) {
    case 'trace_middleware': {
      const { route_path, method } = TraceMiddlewareSchema.parse(rawInput);
      return frameworkService.traceMiddleware(route_path, method);
    }
    case 'get_route_config': {
      const { url_path } = GetRouteConfigSchema.parse(rawInput);
      return frameworkService.getRouteConfig(url_path);
    }
    case 'resolve_config': {
      const { config_key } = ResolveConfigSchema.parse(rawInput);
      return configService.resolveConfig({ config_key });
    }
    default:
      return null;
  }
}
