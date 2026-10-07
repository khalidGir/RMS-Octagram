import { describe, expect, it } from 'vitest';
import { trailingSlashRedirect } from './middleware';

/**
 * Loop-free proof for the trailing-slash policy (ADR-030). Every redirect
 * target must resolve to null on the next pass: one rule adds the slash for
 * bare restaurant roots, the other strips it everywhere else, and the two
 * never fight over the same path.
 */
describe('trailingSlashRedirect', () => {
  it('sends a bare restaurant root into the installed-app scope', () => {
    expect(trailingSlashRedirect('/r/blue-nile')).toBe('/r/blue-nile/');
  });

  it('serves the canonical slash-terminated restaurant root unchanged', () => {
    expect(trailingSlashRedirect('/r/blue-nile/')).toBeNull();
  });

  it('keeps every other trailing-slash URL on the previous no-slash canonical form', () => {
    expect(trailingSlashRedirect('/offline/')).toBe('/offline');
    expect(trailingSlashRedirect('/login/')).toBe('/login');
    expect(trailingSlashRedirect('/o/some-token/')).toBe('/o/some-token');
    expect(trailingSlashRedirect('/r/blue-nile/checkout/')).toBe('/r/blue-nile/checkout');
  });

  it('leaves no-slash URLs and the root alone', () => {
    expect(trailingSlashRedirect('/')).toBeNull();
    expect(trailingSlashRedirect('/offline')).toBeNull();
    expect(trailingSlashRedirect('/o/some-token')).toBeNull();
    expect(trailingSlashRedirect('/r/blue-nile/checkout')).toBeNull();
    expect(trailingSlashRedirect('/r/blue-nile/manifest.webmanifest')).toBeNull();
  });

  it('terminates: every produced target is itself a no-redirect path', () => {
    const inputs = [
      '/r/blue-nile',
      '/r/blue-nile/',
      '/r/blue-nile/checkout',
      '/r/blue-nile/checkout/',
      '/offline',
      '/offline/',
      '/',
      '/o/token/',
    ];
    for (const input of inputs) {
      const target = trailingSlashRedirect(input);
      if (target !== null) expect(trailingSlashRedirect(target)).toBeNull();
    }
  });
});
