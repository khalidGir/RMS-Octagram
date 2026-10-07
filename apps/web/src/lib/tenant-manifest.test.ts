import { describe, expect, it } from 'vitest';
import {
  buildTenantManifest,
  MANIFEST_CACHE_CONTROL,
  MANIFEST_CONTENT_TYPE,
  restaurantManifestTargets,
  ROOT_MANIFEST_TARGETS,
} from './tenant-manifest';
import type { TenantLogoView } from './types';

const logo: TenantLogoView = {
  icon192: 'https://cdn.example.com/logos/tok-abc/192x192.png',
  icon512: 'https://cdn.example.com/logos/tok-abc/512x512.png',
  maskable512: 'https://cdn.example.com/logos/tok-abc/512x512-maskable.png',
  apple180: 'https://cdn.example.com/logos/tok-abc/180x180.png',
  thumbnail: 'https://cdn.example.com/logos/tok-abc/320x320.webp',
};

const targets = restaurantManifestTargets('habesha-house');

/**
 * W3C appmanifest §5: a target is within scope when its path string starts
 * with the scope path (prefix match, same origin) — deliberately
 * string-based, so only a slash-terminated scope keeps /r/{slug}-annex out
 * of /r/{slug}.
 */
function withinScope(target: string, scope: string): boolean {
  return target.startsWith(scope);
}

describe('buildTenantManifest', () => {
  it('uses the restaurant logo derivatives as icons when a logo exists', () => {
    const manifest = buildTenantManifest({ name: 'Habesha House', logo }, targets);
    expect(manifest.icons).toEqual([
      { src: logo.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: logo.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: logo.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('falls back to the default RMS icons when no logo exists', () => {
    const manifest = buildTenantManifest({ name: 'Habesha House', logo: null }, targets);
    expect(manifest.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('wires install targets straight through (caller supplies token-free URLs)', () => {
    const manifest = buildTenantManifest({ name: 'Habesha House', logo: null }, targets);
    expect(manifest.start_url).toBe('/r/habesha-house/');
    expect(manifest.id).toBe('/r/habesha-house/');
    expect(manifest.scope).toBe('/r/habesha-house/');
    expect(manifest.display).toBe('standalone');
  });

  it('keeps start_url inside the declared scope so the scope is not discarded (W3C §1.6)', () => {
    // §1.6 discards a scope that does not contain start_url; §5 then matches
    // by string prefix, so the scope must be slash-terminated or it would
    // also swallow /r/{slug}-annex.
    const manifest = buildTenantManifest({ name: 'Habesha House', logo: null }, targets);
    expect(withinScope(manifest.start_url, manifest.scope)).toBe(true);
    expect(manifest.scope.endsWith('/')).toBe(true);
    expect(manifest.start_url).toBe(manifest.scope);
  });

  it('scopes two restaurants independently, including prefix-collision slugs', () => {
    const a = buildTenantManifest(
      { name: 'Blue Nile', logo: null },
      restaurantManifestTargets('blue-nile'),
    );
    const b = buildTenantManifest(
      { name: 'Blue Nile Annex', logo: null },
      restaurantManifestTargets('blue-nile-annex'),
    );
    expect(withinScope(a.start_url, a.scope)).toBe(true);
    expect(withinScope(b.start_url, b.scope)).toBe(true);
    // The collision case: a bare-prefix scope /r/blue-nile would swallow the
    // annex restaurant's start_url and every page under it.
    expect(withinScope(b.start_url, a.scope)).toBe(false);
    expect(withinScope(a.start_url, b.scope)).toBe(false);
    expect(withinScope('/r/blue-nile-annex/checkout', a.scope)).toBe(false);
    expect(a.id).not.toBe(b.id);
    expect(withinScope('/r/blue-nile/checkout', a.scope)).toBe(true);
    expect(withinScope('/r/habesha-house', a.scope)).toBe(false);
  });

  it('falls back to token-free root targets when no branch slug exists', () => {
    const manifest = buildTenantManifest(
      { name: 'Habesha House', logo: null },
      ROOT_MANIFEST_TARGETS,
    );
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(withinScope(manifest.start_url, manifest.scope)).toBe(true);
  });

  it('keeps short_name within 24 characters for long restaurant names', () => {
    const manifest = buildTenantManifest(
      { name: 'A Very Long Restaurant Name Indeed', logo: null },
      targets,
    );
    expect(manifest.short_name.length).toBeLessThanOrEqual(24);
    expect(manifest.short_name.endsWith('…')).toBe(true);
    expect(manifest.short_name).toBe('A Very Long Restaurant…');
  });

  it('preserves short names verbatim', () => {
    const manifest = buildTenantManifest({ name: 'Habesha House', logo: null }, targets);
    expect(manifest.short_name).toBe('Habesha House');
  });

  it('publishes the caching contract for manifest routes', () => {
    expect(MANIFEST_CACHE_CONTROL).toBe('public, max-age=300, s-maxage=300');
    expect(MANIFEST_CONTENT_TYPE).toBe('application/manifest+json; charset=utf-8');
  });
});
