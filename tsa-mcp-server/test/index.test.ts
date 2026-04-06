import { describe, expect, it } from 'bun:test';
import { getQuickStartPrompt } from '../src/prompt';

const SERVER_PATH = '/srv/tsa/src/index.ts';
const PROJECT_ROOT = '/projects/my-app';
const prompt = getQuickStartPrompt(SERVER_PATH, PROJECT_ROOT);

describe('quick-start prompt', () => {
  it('embeds MCP config with TSA_PROJECT_ROOT baked in so agents work without calling set_project_root', () => {
    const start = prompt.indexOf('{\n  "mcpServers"');
    expect(start).toBeGreaterThan(-1);

    let depth = 0;
    let end = start;
    for (; end < prompt.length; end++) {
      if (prompt[end] === '{') depth++;
      else if (prompt[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }

    const config = JSON.parse(prompt.slice(start, end + 1)) as {
      mcpServers: { tsa: { command: string; args: string[]; env?: Record<string, string> } }
    };

    expect(config.mcpServers.tsa.command).toBe('bun');
    expect(config.mcpServers.tsa.args).toContain(SERVER_PATH);
    expect(config.mcpServers.tsa.env?.TSA_PROJECT_ROOT).toBe(PROJECT_ROOT);
  });

  it('tells the agent to set the project root to the current workspace before navigation', () => {
    expect(prompt).toContain('call set_project_root');
    expect(prompt).toContain('current workspace root');
    expect(prompt).toContain('Do not ask the user to set TSA_PROJECT_ROOT');
  });

  it('still shows the detected project path for advanced/debug visibility', () => {
    expect(prompt.split('\n').at(-1)).toContain(PROJECT_ROOT);
  });
});
