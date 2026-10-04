import { describe, expect, it } from 'vitest';
import { escapeReceiptHtml, safeReceiptFilename } from './receipt';

describe('receipt export helpers', () => {
  it('escapes restaurant-authored content before HTML download', () => {
    expect(escapeReceiptHtml('<Shiro & "More">')).toBe('&lt;Shiro &amp; &quot;More&quot;&gt;');
  });

  it('creates a safe deterministic filename', () => {
    expect(safeReceiptFilename('RMS/BOLE #42')).toBe('RMS-BOLE-42.html');
  });
});
