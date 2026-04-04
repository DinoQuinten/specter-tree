import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SymbolService } from '../services/SymbolService';

const FindSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['class','interface','enum','type_alias','function','method','property',
    'constructor','getter','setter','enum_member','variable']).optional()
});

const SearchSymbolsSchema = z.object({
  query: z.string().min(1),
  kind: z.enum(['class','interface','enum','type_alias','function','method','property',
    'constructor','getter','setter','enum_member','variable']).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const GetMethodsSchema = z.object({
  class_name: z.string().min(1)
});

const GetFileSymbolsSchema = z.object({
  file_path: z.string().min(1),
  kind: z.enum(['class','interface','enum','type_alias','function','method','property',
    'constructor','getter','setter','enum_member','variable']).optional()
});

export const SYMBOL_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'find_symbol',
    description: 'Find a TypeScript symbol by exact name. Returns file path, line, kind, and signature.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact symbol name to find' },
        kind: { type: 'string', description: 'Optional: narrow by symbol kind (class, function, etc.)' }
      },
      required: ['name']
    }
  },
  {
    name: 'search_symbols',
    description: 'Search TypeScript symbols by partial name using LIKE matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial name to search for' },
        kind: { type: 'string', description: 'Optional: narrow by symbol kind' },
        limit: { type: 'number', description: 'Max results (1-100, default 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_methods',
    description: 'Get all methods, properties, and constructors defined in a class.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'Exact class name' }
      },
      required: ['class_name']
    }
  },
  {
    name: 'get_file_symbols',
    description: 'List all symbols declared in a specific file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        kind: { type: 'string', description: 'Optional: filter by symbol kind' }
      },
      required: ['file_path']
    }
  }
];

/**
 * @function handleSymbolTool
 * @description Dispatch symbol tool calls to SymbolService after Zod validation.
 */
export function handleSymbolTool(toolName: string, rawInput: unknown, service: SymbolService): unknown {
  switch (toolName) {
    case 'find_symbol':
      return service.findSymbol(FindSymbolSchema.parse(rawInput));
    case 'search_symbols':
      return service.searchSymbols(SearchSymbolsSchema.parse(rawInput));
    case 'get_methods':
      return service.getMethods(GetMethodsSchema.parse(rawInput));
    case 'get_file_symbols':
      return service.getFileSymbols(GetFileSymbolsSchema.parse(rawInput));
    default:
      return null;
  }
}
