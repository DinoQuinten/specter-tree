import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { ConfigService } from '../../src/services/ConfigService';

const FIXTURES = join(import.meta.dir, '../fixtures');

describe('ConfigService — Next.js', () => {
  const svc = new ConfigService(join(FIXTURES, 'nextjs-project'));

  it('resolves top-level key', () => {
    const result = svc.resolveConfig({ config_key: 'reactStrictMode' });
    expect(result).not.toBeNull();
    expect(result!.final_value).toBe('true');
  });

  it('resolves nested key', () => {
    const result = svc.resolveConfig({ config_key: 'output' });
    expect(result).not.toBeNull();
    expect(result!.final_value).toBe('standalone');
  });

  it('returns null for unknown key', () => {
    const result = svc.resolveConfig({ config_key: 'nonexistent.key' });
    expect(result).toBeNull();
  });

  it('includes chain with source file reference', () => {
    const result = svc.resolveConfig({ config_key: 'output' });
    expect(result!.chain[0]!.source).toContain('next.config.ts');
  });
});

describe('ConfigService — SvelteKit', () => {
  const svc = new ConfigService(join(FIXTURES, 'sveltekit-project'));

  it('resolves nested kit.adapter key', () => {
    const result = svc.resolveConfig({ config_key: 'kit.adapter' });
    expect(result).not.toBeNull();
    expect(result!.final_value).toBe('auto');
  });
});
