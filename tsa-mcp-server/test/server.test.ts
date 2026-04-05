import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTsaServer } from '../src/server';
import { ProjectRuntime } from '../src/runtime/ProjectRuntime';

const FIXTURE = join(import.meta.dir, 'fixtures/simple-ts-project');

describe('MCP server contract', () => {
  let server: ReturnType<typeof createTsaServer>['server'];
  let runtime: ProjectRuntime;

  beforeAll(async () => {
    runtime = new ProjectRuntime({ initialProjectRoot: FIXTURE });
    await runtime.initialize();
    server = createTsaServer(runtime).server;
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  it('lists all registered tools', async () => {
    const handler = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers.get('tools/list')!;
    const result = await handler(ListToolsRequestSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    }), {});

    expect(result.tools.length).toBeGreaterThanOrEqual(14);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'trace_middleware')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'summarize_file_structure')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'resolve_exports')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'find_write_targets')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'explain_flow')).toBe(true);
    expect(result.tools.some((tool: { name: string }) => tool.name === 'set_project_root')).toBe(true);
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

  it('dispatches summarize_file_structure through the MCP server', async () => {
    const handler = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers.get('tools/call')!;
    const result = await handler(CallToolRequestSchema.parse({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'summarize_file_structure',
        arguments: { file_path: join(FIXTURE, 'src/auth/authService.ts') }
      }
    }), {});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('AuthService');
  });
});
