import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOrderingUrl,
  buildShortUrl,
  downloadPngFromSvg,
  downloadSvg,
  printAnchor,
  qrFileSlug,
  serializeQrSvg,
} from './qr-export';

const ORIGIN = 'http://localhost:3000';
const RAW = 'f'.repeat(64);

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 33 33');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  svg.appendChild(rect);
  return svg;
}

describe('qr-export helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:qr-test'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.className = '';
    document.getElementById('rms-print-page-style')?.remove();
  });

  it('builds the ordering URL from origin and raw token', () => {
    expect(buildOrderingUrl(ORIGIN, RAW)).toBe(`${ORIGIN}/o/${RAW}`);
    expect(buildOrderingUrl(`${ORIGIN}/`, RAW)).toBe(`${ORIGIN}/o/${RAW}`);
    expect(buildOrderingUrl(`${ORIGIN}///`, RAW)).toBe(`${ORIGIN}/o/${RAW}`);
  });

  it('builds the short fallback URL only when a public slug exists', () => {
    expect(buildShortUrl(ORIGIN, 'habesha-bole')).toBe(`${ORIGIN}/r/habesha-bole`);
    expect(buildShortUrl(ORIGIN, null)).toBeNull();
    expect(buildShortUrl(ORIGIN, undefined)).toBeNull();
  });

  it('derives a safe filename slug from table labels', () => {
    expect(qrFileSlug('T1')).toBe('t1');
    expect(qrFileSlug('Table 7 / Window')).toBe('table-7-window');
    expect(qrFileSlug('***')).toBe('table');
  });

  it('embeds the target URL as the SVG title', () => {
    const url = `${ORIGIN}/o/${RAW}`;
    const out = serializeQrSvg(makeSvg(), url, 208);
    expect(out).toContain(`<title>${url}</title>`);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="208"');
    expect(out).toContain('height="208"');
    // The title must be the first child so it survives cloning.
    expect(out.indexOf('<title>')).toBeLessThan(out.indexOf('<rect'));
  });

  it('downloads an SVG blob with the requested filename', () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const url = `${ORIGIN}/o/${RAW}`;
    const svgString = serializeQrSvg(makeSvg(), url, 208);
    downloadSvg(svgString, 'qr-t1-v3.svg');

    expect(downloads).toEqual(['qr-t1-v3.svg']);
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1);
    const created = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(created.type).toContain('svg');
  });

  it('rasterizes the same SVG (URL in <title>) to a PNG download', async () => {
    const imageSources: string[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      naturalWidth = 256;
      naturalHeight = 256;
      private _src = '';
      set src(value: string) {
        this._src = value;
        imageSources.push(value);
        queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob(['png-bytes'], { type: 'image/png' }));
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    const url = `${ORIGIN}/o/${RAW}`;
    const svgString = serializeQrSvg(makeSvg(), url, 208);
    await downloadPngFromSvg(svgString, 'qr-t1-v3.png', 208);

    expect(imageSources).toHaveLength(1);
    const decoded = decodeURIComponent(imageSources[0].replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    expect(decoded).toContain(`<title>${url}</title>`);
    expect(drawImage).toHaveBeenCalled();
    expect(downloads).toEqual(['qr-t1-v3.png']);
    const created = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(created.type).toBe('image/png');
  });

  it('rejects the PNG export when the SVG image fails to load', async () => {
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);

    await expect(downloadPngFromSvg('<svg/>', 'x.png', 64)).rejects.toThrow(/failed to load/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('flags the body, keeps the anchor subtree, injects @page rules, then cleans up', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="inner"><div class="qr-print-area"><span>card</span></div></div>';
    document.body.appendChild(wrapper);

    printAnchor('.qr-print-area', '@page { size: A6; margin: 5mm; }');

    expect(document.body.classList.contains('rms-printing')).toBe(true);
    expect(wrapper.classList.contains('rms-print-keep')).toBe(true);
    expect(document.getElementById('rms-print-page-style')?.textContent).toBe('@page { size: A6; margin: 5mm; }');
    expect(window.print).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('afterprint'));

    expect(document.body.classList.contains('rms-printing')).toBe(false);
    expect(wrapper.classList.contains('rms-print-keep')).toBe(false);
    expect(document.getElementById('rms-print-page-style')).toBeNull();
    wrapper.remove();
  });
});
