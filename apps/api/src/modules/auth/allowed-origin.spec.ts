import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './allowed-origin';

describe('exact browser origin allowlist', () => {
  const configured = ['https://restaurant.example.com', 'http://localhost:3000'];
  it('allows exact configured origins and native/server requests', () => {
    expect(isAllowedOrigin(undefined, configured)).toBe(true);
    expect(isAllowedOrigin('https://restaurant.example.com', configured)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', configured)).toBe(true);
  });
  it.each(['https://child.restaurant.example.com', 'http://restaurant.example.com',
    'https://restaurant.example.com:8443', 'http://localhost:3001', 'null',
    'https://restaurant.example.com/other', 'https://restaurant.example.com@evil.example.com'])('denies %s', (origin) => {
    expect(isAllowedOrigin(origin, configured)).toBe(false);
  });
  it.each(['*', '*.example.com', 'https://restaurant.example.com/path',
    'https://user:password@restaurant.example.com', 'https://restaurant.example.com?query=1'])('rejects unsafe configured entries %s', (entry) => {
    expect(isAllowedOrigin('https://restaurant.example.com', [entry])).toBe(false);
  });
});
