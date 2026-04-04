import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { FrameworkService } from '../../src/services/FrameworkService';

const FIXTURES = join(import.meta.dir, '../fixtures');

describe('FrameworkService — Express', () => {
  const svc = new FrameworkService(join(FIXTURES, 'express-project'));

  it('detects express framework', () => {
    const map = svc.getResolverMap();
    expect(Object.keys(map)).toContain('.');
  });

  it('traceMiddleware returns traces for matched route', () => {
    const result = svc.traceMiddleware('/api/users');
    expect(result._meta.framework).toBe('.');
    expect(Array.isArray(result.traces)).toBe(true);
  });
});

describe('FrameworkService — Next.js', () => {
  const svc = new FrameworkService(join(FIXTURES, 'nextjs-project'));

  it('detects nextjs framework', () => {
    const map = svc.getResolverMap();
    expect(Object.keys(map)).toContain('.');
  });

  it('traceMiddleware returns middleware.ts trace', () => {
    const result = svc.traceMiddleware('/api/users');
    expect(result.traces.some(t => t.name === 'middleware')).toBe(true);
  });

  it('getRouteConfig resolves app router route', () => {
    const config = svc.getRouteConfig('/api/users');
    expect(config).not.toBeNull();
    expect(config!.file_path).toContain('route.ts');
  });
});

describe('FrameworkService — SvelteKit', () => {
  const svc = new FrameworkService(join(FIXTURES, 'sveltekit-project'));

  it('detects sveltekit framework', () => {
    const map = svc.getResolverMap();
    expect(Object.keys(map)).toContain('.');
  });

  it('traceMiddleware includes hooks.server.ts', () => {
    const result = svc.traceMiddleware('/api/users');
    expect(result.traces.some(t => t.name === 'handle')).toBe(true);
  });

  it('getRouteConfig resolves +server.ts', () => {
    const config = svc.getRouteConfig('/api/users');
    expect(config).not.toBeNull();
    expect(config!.file_path).toContain('+server.ts');
  });
});
