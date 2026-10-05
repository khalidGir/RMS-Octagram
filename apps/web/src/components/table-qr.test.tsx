import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/locale-provider';
import { apiRequest } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { downloadPngFromSvg, downloadSvg, printAnchor } from '@/lib/qr-export';
import type * as QrExport from '@/lib/qr-export';
import { TableQrBatchDialog, TableQrDialog } from './table-qr';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ApiClient;
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('@/lib/qr-export', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof QrExport;
  return { ...actual, downloadSvg: vi.fn(), downloadPngFromSvg: vi.fn(), printAnchor: vi.fn() };
});

const mockApiRequest = vi.mocked(apiRequest);
const mockDownloadSvg = vi.mocked(downloadSvg);
const mockDownloadPngFromSvg = vi.mocked(downloadPngFromSvg);
const mockPrintAnchor = vi.mocked(printAnchor);

const ORIGIN = window.location.origin;
const RAW = 'a'.repeat(64);
const A6_RULES = '@page { size: A6; margin: 5mm; }';
const A4_RULES = '@page { size: A4; margin: 6mm; }';

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return baseRender(
    <LocaleProvider>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </LocaleProvider>,
  );
}

function branding() {
  return { data: { restaurantName: 'Habesha Kitchen', branchName: 'Bole Branch', publicSlug: 'habesha-bole' } };
}

describe('TableQrDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a token and shows a card with branding, short link, and the exact payload', async () => {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (url.includes('/qr-branding')) return branding();
      if (url.includes('/qr-token/history')) return { data: [] };
      if (url.endsWith('/qr-token/rotate') && options?.method === 'POST') {
        return { data: { raw: RAW, version: 3, tableId: 'tbl-1', branchId: 'b1' } };
      }
      return { data: [] };
    }) as never);

    render(
      <TableQrDialog
        label="T1"
        tableId="tbl-1"
        accessToken="token"
        csrfToken="csrf"
        tenantId="t1"
        branchId="b1"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate QR code' }));

    await screen.findByText('Habesha Kitchen');
    await screen.findByText(`${ORIGIN}/o/${RAW}`);

    const card = document.querySelector('[data-testid="qr-card"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('data-qr-payload')).toBe(`${ORIGIN}/o/${RAW}`);
    expect(card!.getAttribute('data-qr-version')).toBe('3');
    // Short fallback link printed on the card, derived from branch publicSlug.
    expect(card!.textContent).toContain(`${ORIGIN}/r/habesha-bole`);
    expect(card!.textContent).toContain('Bole Branch');

    const rotate = mockApiRequest.mock.calls.find(
      ([url, options]) => url === '/branches/b1/tables/tbl-1/qr-token/rotate' && (options as { method?: string })?.method === 'POST',
    );
    expect(rotate).toBeDefined();
  });

  it('exports SVG and PNG from the card, both carrying the ordering URL', async () => {
    mockApiRequest.mockImplementation((async (url: string) => {
      if (url.includes('/qr-branding')) return branding();
      if (url.includes('/qr-token/history')) {
        return { data: [{ id: 'tok3', version: 3, createdAt: '2026-10-01T08:00:00.000Z', revokedAt: null }] };
      }
      return { data: { raw: RAW, version: 3 } };
    }) as never);

    render(
      <TableQrDialog
        label="T1"
        tableId="tbl-1"
        initialRaw={RAW}
        accessToken="token"
        csrfToken="csrf"
        tenantId="t1"
        branchId="b1"
        onClose={() => {}}
      />,
    );
    await screen.findByText('Habesha Kitchen');

    fireEvent.click(screen.getByTestId('qr-download-svg'));
    expect(mockDownloadSvg).toHaveBeenCalledTimes(1);
    const [svgString, svgName] = mockDownloadSvg.mock.calls[0];
    expect(svgString).toContain(`<title>${ORIGIN}/o/${RAW}</title>`);
    expect(svgName).toBe('qr-t1-v3.svg');

    fireEvent.click(screen.getByTestId('qr-download-png'));
    await waitFor(() => expect(mockDownloadPngFromSvg).toHaveBeenCalledTimes(1));
    const [pngSvg, pngName] = mockDownloadPngFromSvg.mock.calls[0];
    expect(pngSvg).toContain(`<title>${ORIGIN}/o/${RAW}</title>`);
    expect(pngName).toBe('qr-t1-v3.png');
  });

  it('prints the single card with A6 page rules', async () => {
    mockApiRequest.mockImplementation((async () => ({ data: [] })) as never);
    render(
      <TableQrDialog
        label="T1"
        tableId="tbl-1"
        initialRaw={RAW}
        accessToken="token"
        csrfToken="csrf"
        tenantId="t1"
        branchId="b1"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(mockPrintAnchor).toHaveBeenCalledWith('.qr-print-area', A6_RULES);
  });

  it('requires an explicit replace confirmation before rotating again', async () => {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (url.includes('/qr-branding')) return branding();
      if (url.includes('/qr-token/history')) return { data: [] };
      if (url.endsWith('/qr-token/rotate') && options?.method === 'POST') {
        return { data: { raw: RAW, version: 4 } };
      }
      return { data: [] };
    }) as never);

    render(
      <TableQrDialog
        label="T7"
        tableId="tbl-7"
        initialRaw={RAW}
        accessToken="token"
        csrfToken="csrf"
        tenantId="t1"
        branchId="b1"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New QR code' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace this QR code?' });
    expect(confirm.textContent).toContain('stops working immediately');

    const rotateCalls = () =>
      mockApiRequest.mock.calls.filter(
        ([url, options]) =>
          url === '/branches/b1/tables/tbl-7/qr-token/rotate' && (options as { method?: string })?.method === 'POST',
      );
    expect(rotateCalls()).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace this QR code?' })).toBeNull());
    expect(rotateCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'New QR code' }));
    const confirmAgain = await screen.findByRole('dialog', { name: 'Replace this QR code?' });
    fireEvent.click(within(confirmAgain).getByRole('button', { name: 'Replace code' }));

    await waitFor(() => expect(rotateCalls()).toHaveLength(1));
    await waitFor(() => {
      expect(document.querySelector('[data-testid="qr-card"]')?.getAttribute('data-qr-version')).toBe('4');
    });
  });
});

describe('TableQrBatchDialog', () => {
  const tables = [
    { tableId: 'tbl-1', label: 'T1' },
    { tableId: 'tbl-2', label: 'T2' },
    { tableId: 'tbl-3', label: 'T3' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderBatch(rotations: unknown) {
    mockApiRequest.mockImplementation((async (url: string, options?: { method?: string }) => {
      if (url.includes('/qr-branding')) return branding();
      if (url.includes('qr-token/rotate-batch') && options?.method === 'POST') return { data: rotations };
      return { data: [] };
    }) as never);

    return render(
      <TableQrBatchDialog
        tables={tables}
        accessToken="token"
        csrfToken="csrf"
        tenantId="t1"
        branchId="b1"
        onClose={() => {}}
      />,
    );
  }

  it('rotates exactly the selected tables and previews only their cards', async () => {
    renderBatch([
      { tableId: 'tbl-1', label: 'T1', raw: '1'.repeat(64), version: 5 },
      { tableId: 'tbl-3', label: 'T3', raw: '2'.repeat(64), version: 5 },
    ]);

    const generate = screen.getByTestId('batch-generate');
    expect(generate).toBeDisabled();

    fireEvent.click(screen.getByTestId('batch-table-T1'));
    fireEvent.click(screen.getByTestId('batch-table-T3'));
    expect(generate).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Compact sticker' }));
    expect(screen.getByRole('button', { name: 'Compact sticker' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(generate);
    const confirm = await screen.findByRole('dialog', { name: 'Replace 2 QR codes?' });
    expect(confirm.textContent).toContain('stops working immediately');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Generate codes' }));

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(([url]) => url.includes('qr-token/rotate-batch'));
      expect(call).toBeDefined();
      expect((call![1] as { body?: { tableIds?: string[] } }).body?.tableIds).toEqual(['tbl-1', 'tbl-3']);
    });

    await screen.findByTestId('qr-batch-preview');
    const cards = document.querySelectorAll('[data-testid="qr-card"]');
    expect(cards).toHaveLength(2);
    const labels = [...cards].map((c) => c.getAttribute('data-table-label'));
    expect(labels).toEqual(['T1', 'T3']);
    const payloads = [...cards].map((c) => c.getAttribute('data-qr-payload'));
    expect(payloads).toEqual([`${ORIGIN}/o/${'1'.repeat(64)}`, `${ORIGIN}/o/${'2'.repeat(64)}`]);
    const sheet = screen.getByTestId('qr-batch-sheet');
    expect(sheet.className).toContain('qr-sheet-sticker');
    // Raw tokens are shown once, never re-fetched: no history call for batches.
    expect(mockApiRequest.mock.calls.some(([url]) => url.includes('/qr-token/history'))).toBe(false);
  });

  it('prints the batch sheet with A4 page rules and drops the preview on Back', async () => {
    renderBatch([{ tableId: 'tbl-2', label: 'T2', raw: '3'.repeat(64), version: 1 }]);

    fireEvent.click(screen.getByTestId('batch-table-T2'));
    fireEvent.click(screen.getByTestId('batch-generate'));
    const confirm = await screen.findByRole('dialog', { name: 'Replace 1 QR codes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Generate codes' }));

    await screen.findByTestId('qr-batch-preview');
    // Layout can be switched from the preview itself without re-rotating tokens.
    const preview = within(screen.getByTestId('qr-batch-preview'));
    fireEvent.click(preview.getByRole('button', { name: 'Compact sticker' }));
    expect(screen.getByTestId('qr-batch-sheet').className).toContain('qr-sheet-sticker');
    fireEvent.click(preview.getByRole('button', { name: 'A6 tabletop card' }));
    expect(screen.getByTestId('qr-batch-sheet').className).toContain('qr-sheet-a6');

    fireEvent.click(screen.getByTestId('qr-batch-print'));
    expect(mockPrintAnchor).toHaveBeenCalledWith('.qr-print-sheet', A4_RULES);

    fireEvent.click(screen.getByTestId('qr-batch-back'));
    await waitFor(() => expect(screen.queryByTestId('qr-batch-preview')).toBeNull());
  });

  it('toggles every table through Select all', () => {
    renderBatch([]);
    fireEvent.click(screen.getByTestId('batch-select-all'));
    for (const t of tables) {
      expect((screen.getByTestId(`batch-table-${t.label}`) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.getByTestId('batch-generate')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('batch-select-all'));
    for (const t of tables) {
      expect((screen.getByTestId(`batch-table-${t.label}`) as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.getByTestId('batch-generate')).toBeDisabled();
  });

  it('surfaces a batch failure instead of opening the preview', async () => {
    renderBatch([]);

    fireEvent.click(screen.getByTestId('batch-table-T1'));
    fireEvent.click(screen.getByTestId('batch-generate'));
    const confirm = await screen.findByRole('dialog', { name: 'Replace 1 QR codes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Generate codes' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not generate the selected QR codes.');
    expect(screen.queryByTestId('qr-batch-preview')).toBeNull();
  });
});
