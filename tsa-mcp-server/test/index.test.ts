import { describe, expect, it } from 'bun:test';
import { getQuickStartPrompt } from '../src/prompt';

const SERVER_PATH = '/srv/tsa/src/index.ts';
const PROJECT_ROOT = '/projects/my-app';
const prompt = getQuickStartPrompt(SERVER_PATH, PROJECT_ROOT);

describe('quick-start prompt — connection config', () => {
  it('embeds valid JSON with the correct MCP server shape', () => {
    // Extract the JSON block by counting braces from the first { after "mcpServers"
    const start = prompt.indexOf('{\n  "mcpServers"');
    expect(start).toBeGreaterThan(-1);
    let depth = 0, end = start;
    for (; end < prompt.length; end++) {
      if (prompt[end] === '{') depth++;
      else if (prompt[end] === '}') { depth--; if (depth === 0) break; }
    }
    const config = JSON.parse(prompt.slice(start, end + 1)) as {
      mcpServers: { tsa: { command: string; args: string[]; env: { TSA_PROJECT_ROOT: string } } }
    };
    expect(config.mcpServers.tsa.command).toBe('bun');
    expect(config.mcpServers.tsa.args).toContain(SERVER_PATH);
    expect(config.mcpServers.tsa.env.TSA_PROJECT_ROOT).toBe(PROJECT_ROOT);
  });

  it('shows the indexed project path at the end', () => {
    expect(prompt.split('\n').at(-1)).toContain(PROJECT_ROOT);
  });
});

describe('quick-start prompt — agent instructions', () => {
  it('has a STEP 1 connect block before STEP 2 confirm block', () => {
    const step1 = prompt.indexOf('STEP 1');
    const step2 = prompt.indexOf('STEP 2');
    expect(step1).toBeGreaterThan(-1);
    expect(step2).toBeGreaterThan(step1);
  });

  it('lists all four tool categories', () => {
    for (const section of ['SYMBOL LOOKUP', 'RELATIONSHIPS', 'FRAMEWORK & CONFIG', 'INSIGHT', 'INDEX CONTROL']) {
      expect(prompt).toContain(section);
    }
  });

  it('includes flush_file rule before the tool listing', () => {
    const rulePos = prompt.indexOf('flush_file(file_path) so the index');
    const toolPos = prompt.indexOf('INDEX CONTROL');
    expect(rulePos).toBeGreaterThan(-1);
    expect(rulePos).toBeLessThan(toolPos);
  });
});
