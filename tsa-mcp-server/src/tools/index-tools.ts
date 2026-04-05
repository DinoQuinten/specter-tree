/**
 * @file index-tools.ts
 * @description MCP tool definitions and request dispatch for project indexing and file-flush tools.
 * @module tools
 */
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectRuntime } from '../runtime/ProjectRuntime';

const FlushFileSchema = z.object({
  file_path: z.string().min(1)
});

const IndexProjectSchema = z.object({
  project_root: z.string().min(1)
});

const SetProjectRootSchema = z.object({
  project_root: z.string().min(1).refine(path => isAbsolute(path), {
    message: 'project_root must be an absolute path'
  })
});

export const INDEX_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'set_project_root',
    description: 'Bind specter-tree to the active workspace root, build the index for that project, and start watching it for changes.',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Absolute path to the workspace root this session should index' }
      },
      required: ['project_root']
    }
  },
  {
    name: 'flush_file',
    description: 'Force immediate re-index of a file, bypassing the 300ms debounce. Use after writing a file to ensure queries see the latest symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to re-index' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'index_project',
    description: 'Trigger a full project scan, indexing all .ts/.tsx files. Skips files whose content hash has not changed.',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Absolute path to the project root to scan' }
      },
      required: ['project_root']
    }
  }
];

/**
 * @description Dispatches indexing MCP tools after validating request payloads.
 * @param toolName - MCP tool name requested by the client.
 * @param rawInput - Untrusted tool input supplied through the MCP transport.
 * @param runtime - Mutable project runtime owning the active root and service graph.
 * @returns Tool-specific response payload.
 * @throws {Error} - When validation fails or the service is unavailable.
 */
export async function handleIndexTool(toolName: string, rawInput: unknown, runtime: ProjectRuntime): Promise<unknown> {
  switch (toolName) {
    case 'set_project_root':
      return runtime.setProjectRoot(SetProjectRootSchema.parse(rawInput).project_root);
    case 'flush_file':
      return runtime.getServices().indexer.flushFile(FlushFileSchema.parse(rawInput).file_path);
    case 'index_project': {
      const { project_root } = IndexProjectSchema.parse(rawInput);
      if (runtime.getProjectRoot() !== project_root) {
        throw new Error('index_project only re-scans the active root; call set_project_root first');
      }
      const start = Date.now();
      await runtime.getServices().indexer.scanProject(project_root);
      return {
        success: true,
        project_root,
        indexed: runtime.getServices().db.getAllFilePaths().length,
        time_ms: Date.now() - start,
        reindexed: true
      };
    }
    default:
      throw new Error(`Unreachable: unknown tool ${toolName}`);
  }
}
