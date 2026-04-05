import { beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTsaServer } from '../src/server';
import { DatabaseService } from '../src/services/DatabaseService';
import { ParserService } from '../src/services/ParserService';
import { IndexerService } from '../src/services/IndexerService';
import { SymbolService } from '../src/services/SymbolService';
import { ReferenceService } from '../src/services/ReferenceService';
import { FrameworkService } from '../src/services/FrameworkService';
import { ConfigService } from '../src/services/ConfigService';

const FIXTURE = join(import.meta.dir, 'fixtures/simple-ts-project');

describe('MCP server contract', () => {
  let server: ReturnType<typeof createTsaServer>['server'];

  beforeAll(async () => {
    const raw = new Database(':memory:');
    const db = new DatabaseService(raw);
    db.initialize();
    const parser = new ParserService();
    const indexer = new IndexerService(db, parser);
    await indexer.scanProject(FIXTURE);

    server = createTsaServer({
      db,
      indexer,
      symbols: new SymbolService(db),
      references: new ReferenceService(db),
      framework: new FrameworkService(FIXTURE),
      config: new ConfigService(FIXTURE)
    }).server;
  });

  it('lists all registered tools', async () => {
    const handler = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers.get('tools/list')!;
    const result = await handler(ListToolsRequestSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    }), {});

    expect(result.tools.length).toBeGreaterThanOrEqual(11);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'trace_middleware')).toBe(true);
  });

  it('returns a structured validation error for invalid tool input', async () => {
    const handler = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers.get('tools/call')!;
    const result = await handler(CallToolRequestSchema.parse({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'find_symbol', arguments: {} }
    }), {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('VALIDATION_ERROR');
  });

  it('returns a structured error for unknown tools', async () => {
    const handler = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers.get('tools/call')!;
    const result = await handler(CallToolRequestSchema.parse({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'missing_tool', arguments: {} }
    }), {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool: missing_tool');
  });
});
