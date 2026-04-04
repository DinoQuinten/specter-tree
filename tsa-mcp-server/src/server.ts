import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { logger } from './logging/logger';
import { LogEvents } from './logging/logEvents';
import type { DatabaseService } from './services/DatabaseService';
import type { IndexerService } from './services/IndexerService';
import type { SymbolService } from './services/SymbolService';
import type { ReferenceService } from './services/ReferenceService';
import type { FrameworkService } from './services/FrameworkService';
import type { ConfigService } from './services/ConfigService';
import { SYMBOL_TOOL_DEFINITIONS, handleSymbolTool } from './tools/symbol-tools';
import { REFERENCE_TOOL_DEFINITIONS, handleReferenceTool } from './tools/reference-tools';
import { INDEX_TOOL_DEFINITIONS, handleIndexTool } from './tools/index-tools';
import { RUNTIME_TOOL_DEFINITIONS, handleRuntimeTool } from './tools/runtime-tools';

const ALL_TOOLS = [
  ...SYMBOL_TOOL_DEFINITIONS,
  ...REFERENCE_TOOL_DEFINITIONS,
  ...INDEX_TOOL_DEFINITIONS,
  ...RUNTIME_TOOL_DEFINITIONS
];

const SYMBOL_TOOL_NAMES = new Set(SYMBOL_TOOL_DEFINITIONS.map(t => t.name));
const REFERENCE_TOOL_NAMES = new Set(REFERENCE_TOOL_DEFINITIONS.map(t => t.name));
const INDEX_TOOL_NAMES = new Set(INDEX_TOOL_DEFINITIONS.map(t => t.name));
const RUNTIME_TOOL_NAMES = new Set(RUNTIME_TOOL_DEFINITIONS.map(t => t.name));

interface ServiceContainer {
  db: DatabaseService;
  indexer: IndexerService;
  symbols: SymbolService;
  references: ReferenceService;
  framework: FrameworkService;
  config: ConfigService;
}

/**
 * @function createTsaServer
 * @description Build and wire up the MCP Server instance with all tool handlers.
 * Does not connect transport — call server.connect(transport) after.
 */
export function createTsaServer(services: ServiceContainer): Server {
  const server = new Server(
    { name: 'tsa-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: rawInput } = request.params;
    const start = Date.now();

    try {
      let result: unknown;

      if (SYMBOL_TOOL_NAMES.has(toolName)) {
        result = handleSymbolTool(toolName, rawInput, services.symbols);
      } else if (REFERENCE_TOOL_NAMES.has(toolName)) {
        result = handleReferenceTool(toolName, rawInput, services.references);
      } else if (INDEX_TOOL_NAMES.has(toolName)) {
        result = await handleIndexTool(toolName, rawInput, services.indexer);
      } else if (RUNTIME_TOOL_NAMES.has(toolName)) {
        result = handleRuntimeTool(toolName, rawInput, services.framework, services.config);
      } else {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
          isError: true
        };
      }

      logger.debug({ event: LogEvents.TOOL_CALLED, tool: toolName, ms: Date.now() - start });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }]
      };
    } catch (err) {
      const isValidation = err instanceof ZodError;
      const message = isValidation
        ? `Validation error: ${(err as ZodError).issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        : String(err);

      logger.error({ event: LogEvents.TOOL_CALLED, tool: toolName, error: message });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: false,
          error: { code: isValidation ? 'VALIDATION_ERROR' : 'TOOL_ERROR', message },
          _meta: { query_ms: Date.now() - start }
        }) }],
        isError: true
      };
    }
  });

  return server;
}

/**
 * @function startServer
 * @description Connect server to StdioServerTransport and begin serving.
 */
export async function startServer(services: ServiceContainer): Promise<void> {
  const server = createTsaServer(services);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ event: LogEvents.SERVER_STARTED, tools: ALL_TOOLS.length });
}
