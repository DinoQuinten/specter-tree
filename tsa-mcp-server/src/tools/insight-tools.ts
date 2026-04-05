/**
 * @file insight-tools.ts
 * @description MCP tool definitions and request dispatch for file-summary, export-resolution,
 * and edit-target insight tools.
 * @module tools
 */
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { InsightService } from '../services/InsightService';

const SummarizeFileStructureSchema = z.object({
  file_path: z.string().min(1)
});

const ResolveExportsSchema = z.object({
  file_path: z.string().min(1),
  export_name: z.string().min(1)
});

const FindWriteTargetsSchema = z.object({
  symbol_name: z.string().min(1),
  class_name: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional()
});

const ExplainFlowSchema = z.object({
  symbol_name: z.string().min(1).optional(),
  file_path: z.string().min(1).optional(),
  route_path: z.string().min(1).optional(),
  class_name: z.string().min(1).optional(),
  max_depth: z.number().int().min(1).max(4).optional()
});

export const INSIGHT_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'summarize_file_structure',
    description: 'Return a compact structural summary of a file: exports, declarations, imports, and top-level effects.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to summarize' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'resolve_exports',
    description: 'Resolve a named export from a barrel or module file to the file where it is declared.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the exporting file' },
        export_name: { type: 'string', description: 'Named export to resolve' }
      },
      required: ['file_path', 'export_name']
    }
  },
  {
    name: 'find_write_targets',
    description: 'Rank the most likely edit locations for a symbol using declarations, callers, implementors, and subclasses.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string', description: 'Symbol to change' },
        class_name: { type: 'string', description: 'Optional containing class for method disambiguation' },
        limit: { type: 'number', description: 'Maximum targets to return (default 10)' }
      },
      required: ['symbol_name']
    }
  },
  {
    name: 'explain_flow',
    description: 'Build a compact structural flow from a symbol, file, or route path, including middleware for route entrypoints. Exactly one of symbol_name, file_path, or route_path must be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string', description: 'Optional symbol name entrypoint' },
        file_path: { type: 'string', description: 'Optional file path entrypoint' },
        route_path: { type: 'string', description: 'Optional route path entrypoint' },
        class_name: { type: 'string', description: 'Optional containing class for method disambiguation' },
        max_depth: { type: 'number', description: 'Maximum traversal depth (default 3, max 4)' }
      }
    }
  }
];

/**
 * @description Dispatches insight-oriented MCP tools after validating request payloads.
 * @param toolName - MCP tool name requested by the client.
 * @param rawInput - Untrusted tool input supplied through the MCP transport.
 * @param service - Insight service instance that owns the implementation.
 * @returns Tool-specific response payload.
 * @throws {Error} - When validation fails or the service is unavailable.
 */
export function handleInsightTool(toolName: string, rawInput: unknown, service: InsightService): unknown {
  if (!service) throw new Error('InsightService is not available');
  switch (toolName) {
    case 'summarize_file_structure':
      return service.summarizeFileStructure(SummarizeFileStructureSchema.parse(rawInput));
    case 'resolve_exports':
      return service.resolveExports(ResolveExportsSchema.parse(rawInput));
    case 'find_write_targets':
      return service.findWriteTargets(FindWriteTargetsSchema.parse(rawInput));
    case 'explain_flow':
      return service.explainFlow(ExplainFlowSchema.parse(rawInput));
    default:
      throw new Error(`Unreachable: unknown tool ${toolName}`);
  }
}
