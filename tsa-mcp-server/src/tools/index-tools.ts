import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { IndexerService } from '../services/IndexerService';

const FlushFileSchema = z.object({
  file_path: z.string().min(1)
});

const IndexProjectSchema = z.object({
  project_root: z.string().min(1)
});

export const INDEX_TOOL_DEFINITIONS: Tool[] = [
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
 * @function handleIndexTool
 * @description Dispatch index tool calls to IndexerService after Zod validation.
 */
export async function handleIndexTool(toolName: string, rawInput: unknown, service: IndexerService): Promise<unknown> {
  if (!service) throw new Error('IndexerService is not available');
  switch (toolName) {
    case 'flush_file':
      return service.flushFile(FlushFileSchema.parse(rawInput).file_path);
    case 'index_project': {
      const { project_root } = IndexProjectSchema.parse(rawInput);
      const start = Date.now();
      await service.scanProject(project_root);
      return { success: true, project_root, time_ms: Date.now() - start };
    }
    default:
      return null;
  }
}
