import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema
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

/** Wraps a Server with an in-flight request counter for graceful drain. */
export interface TsaServer {
  server: Server;
  /** Resolves when all in-flight requests complete. Timeout after ms (default 5000). */
  drain(timeoutMs?: number): Promise<void>;
}

/**
 * @function createTsaServer
 * @description Build and wire up the MCP Server instance with all tool handlers.
 * Does not connect transport — call server.connect(transport) after.
 */
export function createTsaServer(services: ServiceContainer): TsaServer {
  let inFlight = 0;
  let drainResolve: (() => void) | null = null;

  const drain = (timeoutMs = 5000): Promise<void> => {
    if (inFlight === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        drainResolve = null;
        resolve();
      }, timeoutMs);
      drainResolve = () => { clearTimeout(timer); resolve(); };
    });
  };

  const server = new Server(
    { name: 'tsa-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'tsa://files',
        name: 'Indexed files',
        description: 'All TypeScript files currently in the index',
        mimeType: 'application/json'
      },
      {
        uri: 'tsa://symbols',
        name: 'Indexed symbol names',
        description: 'All distinct symbol names in the index',
        mimeType: 'application/json'
      }
    ]
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: 'tsa://file/{path}',
        name: 'Symbols in file',
        description: 'All symbols declared in a specific indexed file',
        mimeType: 'application/json'
      },
      {
        uriTemplate: 'tsa://symbol/{name}',
        name: 'Symbol record',
        description: 'Full record for a named symbol',
        mimeType: 'application/json'
      }
    ]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (uri === 'tsa://files') {
      const files = services.db.getAllFilePaths();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(files) }] };
    }

    if (uri === 'tsa://symbols') {
      const names = Array.from(services.db.getAllSymbolNames()).sort();
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(names) }] };
    }

    const fileMatch = uri.match(/^tsa:\/\/file\/(.+)$/);
    if (fileMatch) {
      const filePath = decodeURIComponent(fileMatch[1]!);
      const symbols = services.db.getSymbolsByFile(filePath);
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(symbols) }] };
    }

    const symbolMatch = uri.match(/^tsa:\/\/symbol\/(.+)$/);
    if (symbolMatch) {
      const name = decodeURIComponent(symbolMatch[1]!);
      const symbols = services.db.querySymbolsByName(name);
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(symbols) }] };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: rawInput } = request.params;
    const start = Date.now();
    inFlight++;

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
    } finally {
      inFlight--;
      if (inFlight === 0 && drainResolve) { drainResolve(); drainResolve = null; }
    }
  });

  return { server, drain };
}

/**
 * @function startServer
 * @description Connect server to StdioServerTransport and begin serving.
 */
export async function startServer(services: ServiceContainer): Promise<TsaServer> {
  const tsaServer = createTsaServer(services);
  const transport = new StdioServerTransport();
  await tsaServer.server.connect(transport);
  logger.info({ event: LogEvents.SERVER_STARTED, tools: ALL_TOOLS.length });
  return tsaServer;
}
