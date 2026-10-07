import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const swSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

describe('service worker caching policy', () => {
  it('uses a versioned cache name so policy changes purge previously cached entries', () => {
    expect(swSource).toMatch(/const CACHE_NAME = 'rms-shell-v\d+'/);
    expect(swSource).toContain('rms-shell-v4');
  });

  it('caches only menu-serving public endpoints', () => {
    const listMatch = swSource.match(/PUBLIC_API_CACHE_PREFIXES = \[([^\]]*)\]/);
    const prefixes = listMatch?.[1] ?? '';
    expect(prefixes).toContain('/api/v1/public/restaurants/');
    expect(prefixes).toContain('/api/v1/public/tenants/');
    expect(prefixes).not.toContain('/orders/');
    expect(prefixes).not.toContain('/payments/');
    expect(swSource).not.toMatch(/PUBLIC_API_PREFIX\s*=/);
  });

  it('never caches presigned (X-Amz) URLs such as private payment proofs', () => {
    expect(swSource).toContain('function isSignedUrl');
    expect(swSource).toContain("href.includes('X-Amz-')");
    expect(swSource).toMatch(/request\.destination === 'image' && !isSignedUrl\(request\.url\)/);
  });

  it('keeps mutations network-only except the read-only table-context resolve', () => {
    expect(swSource).toContain("request.method === 'POST'");
    expect(swSource).toContain("url.pathname.endsWith('/public/table-context/resolve')");
  });
});
