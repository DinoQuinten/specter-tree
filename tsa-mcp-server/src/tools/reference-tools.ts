/**
 * @file reference-tools.ts
 * @description MCP tool definitions and request dispatch for call-graph, hierarchy, and
 * file-relationship reference tools.
 * @module tools
 */
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ReferenceService } from '../services/ReferenceService';

const GetCallersSchema = z.object({
  symbol_name: z.string().min(1),
  class_name: z.string().optional()
});

const GetImplementationsSchema = z.object({
  interface_name: z.string().min(1)
});

const GetHierarchySchema = z.object({
  class_name: z.string().min(1)
});

const GetRelatedFilesSchema = z.object({
  file_path: z.string().min(1)
});

export const REFERENCE_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'get_callers',
    description: 'Find all call sites for a named function or method. Best-effort — DI and dynamic dispatch may be missing.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string', description: 'Exact function or method name' },
        class_name: { type: 'string', description: 'Optional: restrict to methods on this class' }
      },
      required: ['symbol_name']
    }
  },
  {
    name: 'get_implementations',
    description: 'Find all classes that implement a given TypeScript interface.',
    inputSchema: {
      type: 'object',
      properties: {
        interface_name: { type: 'string', description: 'Exact interface name' }
      },
      required: ['interface_name']
    }
  },
  {
    name: 'get_hierarchy',
    description: 'Get full inheritance/implementation hierarchy for a class: what it extends, what it implements, and what extends/implements it.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'Exact class name' }
      },
      required: ['class_name']
    }
  },
  {
    name: 'get_related_files',
    description: 'Find files this file imports from and files that import this file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' }
      },
      required: ['file_path']
    }
  }
];

/**
 * @description Dispatches call-graph and reference MCP tools after validating request payloads.
 * @param toolName - MCP tool name requested by the client.
 * @param rawInput - Untrusted tool input supplied through the MCP transport.
 * @param service - Reference service instance that owns the implementation.
 * @returns Tool-specific response payload.
 * @throws {Error} - When validation fails or the service is unavailable.
 */
export function handleReferenceTool(toolName: string, rawInput: unknown, service: ReferenceService): unknown {
  if (!service) throw new Error('ReferenceService is not available');
  switch (toolName) {
    case 'get_callers':
      return service.getCallers(GetCallersSchema.parse(rawInput));
    case 'get_implementations':
      return service.getImplementations(GetImplementationsSchema.parse(rawInput));
    case 'get_hierarchy':
      return service.getHierarchy(GetHierarchySchema.parse(rawInput));
    case 'get_related_files':
      return service.getRelatedFiles(GetRelatedFilesSchema.parse(rawInput));
    default:
      throw new Error(`Unreachable: unknown tool ${toolName}`);
  }
}
