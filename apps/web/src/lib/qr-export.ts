/**
 * Export helpers for table QR assets.
 *
 * The raw QR token exists only in memory (the server stores a hash), so every
 * export is built from the in-hand plaintext token and the public ordering URL
 * derived from it. Nothing here can reconstruct a token that is no longer held.
 */

const PRINT_PAGE_STYLE_ID = 'rms-print-page-style';
export const PRINT_BODY_CLASS = 'rms-printing';
export const PRINT_KEEP_CLASS = 'rms-print-keep';

export function buildOrderingUrl(origin: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, '')}/o/${rawToken}`;
}

/** Short human-typer fallback that opens the branch menu when a QR scan fails. */
export function buildShortUrl(origin: string, publicSlug: string | null | undefined): string | null {
  if (!publicSlug) return null;
  return `${origin.replace(/\/+$/, '')}/r/${publicSlug}`;
}

/** Safe filename fragment from a table label (keeps letters/numbers, collapses the rest). */
export function qrFileSlug(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'table';
}

/**
 * Serialize a rendered QR SVG together with its target URL as the SVG title,
 * so exports carry an inspectable, testable record of what they encode.
 */
export function serializeQrSvg(svg: SVGSVGElement, url: string, size: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(size));
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = url;
  clone.insertBefore(title, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best effort: the object URL already expires with the document.
    }
  }, 0);
}

export function downloadSvg(svgString: string, filename: string): void {
  downloadBlob(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

/**
 * Rasterize a QR SVG to PNG with the browser's own canvas — no extra
 * dependencies. The SVG (and therefore its URL title) is the single source of
 * truth for both export formats.
 */
export function downloadPngFromSvg(svgString: string, filename: string, size: number): Promise<void> {
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  const image = new Image();
  image.width = size;
  image.height = size;

  return new Promise<void>((resolve, reject) => {
    image.onload = () => {
      try {
        const scale = 8;
        const canvas = document.createElement('canvas');
        canvas.width = size * scale;
        canvas.height = size * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('PNG encoding failed'));
            return;
          }
          downloadBlob(blob, filename);
          resolve();
        }, 'image/png');
      } catch (error) {
        reject(error instanceof Error ? error : new Error('PNG export failed'));
      }
    };
    image.onerror = () => reject(new Error('QR image failed to load'));
    image.src = source;
  });
}

/**
 * Inject `@page` rules for the print job that is about to run, and clear them
 * again once printing finishes so screen layouts stay untouched.
 */
export function setPrintPageRules(css: string | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = (existing ?? document.createElement('style')) as HTMLStyleElement;
  style.id = PRINT_PAGE_STYLE_ID;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

/** Walk up from `el` to the element that is a direct child of `document.body`. */
function topLevelChild(el: Element): HTMLElement | null {
  let node: Element = el;
  while (node.parentElement && node.parentElement !== document.body) node = node.parentElement;
  if (node.parentElement !== document.body) return null;
  return node instanceof HTMLElement ? node : null;
}

/**
 * Print only the surface containing `anchorSelector` (a `.qr-print-area` card
 * or a `.qr-print-sheet` batch), flow it across pages, and apply `pageRules`
 * (`@page { size: … }`) for the duration of the job.
 *
 * The anchor's top-level body child is flagged so the print stylesheet can
 * keep that subtree (including fixed-position dialogs) while every other body
 * child — the app underneath, modal overlays — is removed from the printed
 * flow. Without this, hidden flow content produced blank pages around the card.
 *
 * Cleanup runs on `afterprint`, which browsers fire even when the user cancels
 * the print dialog.
 */
export function printAnchor(anchorSelector: string, pageRules: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const anchor = document.querySelector<HTMLElement>(anchorSelector);
  const keep = anchor ? topLevelChild(anchor) : null;
  const body = document.body;

  keep?.classList.add(PRINT_KEEP_CLASS);
  body.classList.add(PRINT_BODY_CLASS);
  setPrintPageRules(pageRules);

  const cleanup = () => {
    keep?.classList.remove(PRINT_KEEP_CLASS);
    body.classList.remove(PRINT_BODY_CLASS);
    setPrintPageRules(null);
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
