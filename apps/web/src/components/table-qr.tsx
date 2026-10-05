'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useLocale } from '@/components/locale-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  buildOrderingUrl,
  buildShortUrl,
  downloadPngFromSvg,
  downloadSvg,
  printAnchor,
  qrFileSlug,
  serializeQrSvg,
} from '@/lib/qr-export';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface QrIdentity {
  restaurantName: string;
  branchName: string;
  publicSlug: string | null;
}

export interface QrTokenRotation {
  tableId: string;
  label: string;
  raw: string;
  version: number;
}

interface QrTokenMeta {
  id?: string;
  version: number;
  createdAt?: string | null;
  revokedAt?: string | null;
}

type QrLayout = 'a6' | 'sticker';

const QR_PREVIEW_SIZE = 208;
const STICKER_PREVIEW_SIZE = 132;
const A6_PAGE_RULES = '@page { size: A6; margin: 5mm; }';
const BATCH_PAGE_RULES = '@page { size: A4; margin: 6mm; }';

/* -------------------------------------------------------------------------- */
/*                              Shared queries                                */
/* -------------------------------------------------------------------------- */

function useQrIdentity(accessToken: string, tenantId: string, branchId: string) {
  return useQuery({
    queryKey: ['qr-identity', branchId],
    enabled: Boolean(accessToken && branchId),
    queryFn: async () => {
      const response = await apiRequest<ApiEnvelope<QrIdentity>>(`/branches/${branchId}/qr-branding`, {
        accessToken,
        tenantId,
      });
      // Tolerate empty/mocked envelopes so a branding hiccup never blocks the QR UI.
      return Array.isArray(response.data) ? null : response.data;
    },
  });
}

function useQrTokenHistory(accessToken: string, tenantId: string, branchId: string, tableId: string) {
  return useQuery({
    queryKey: ['qr-token-history', branchId, tableId],
    enabled: Boolean(accessToken && branchId && tableId),
    queryFn: async () => {
      const response = await apiRequest<ApiEnvelope<QrTokenMeta[]>>(
        `/branches/${branchId}/tables/${tableId}/qr-token/history`,
        { accessToken, tenantId },
      );
      return Array.isArray(response.data) ? response.data : [];
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                                TableQrCard                                 */
/* -------------------------------------------------------------------------- */

export interface TableQrCardProps {
  layout: QrLayout;
  identity: QrIdentity | null;
  tableLabel: string;
  url: string;
  meta?: QrTokenMeta | null;
  cardRef?: React.Ref<HTMLDivElement>;
}

/**
 * The printable QR asset. The raw ordering URL is carried in `data-qr-payload`
 * (and embedded as the exported SVG's `<title>`) because the QR itself is only
 * pixels — tests and staff inspect the payload attribute instead of decoding.
 */
export function TableQrCard({ layout, identity, tableLabel, url, meta, cardRef }: TableQrCardProps) {
  const { tr, formatDate } = useLocale();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shortUrl = buildShortUrl(origin, identity?.publicSlug);

  const metaParts: string[] = [];
  if (typeof meta?.version === 'number') {
    metaParts.push(tr('tables.qrTokenVersion', { version: meta.version }));
    if (meta.createdAt) {
      metaParts.push(tr('tables.qrTokenCreated', { date: formatDate(meta.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }) }));
    }
    metaParts.push(tr(meta.revokedAt ? 'tables.qrTokenRevoked' : 'tables.qrTokenActive'));
  }

  return (
    <div
      ref={cardRef}
      data-testid="qr-card"
      data-table-label={tableLabel}
      data-qr-payload={url}
      data-qr-version={meta?.version ?? ''}
      className={`qr-card ${layout === 'a6' ? 'qr-card-a6' : 'qr-card-sticker'}`}
    >
      {identity?.restaurantName && <p className="qr-card-brand">{identity.restaurantName}</p>}
      {identity?.branchName && <p className="qr-card-branch">{identity.branchName}</p>}
      <div className="qr-code-box">
        <QRCodeSVG value={url} size={layout === 'a6' ? QR_PREVIEW_SIZE : STICKER_PREVIEW_SIZE} marginSize={2} />
      </div>
      <p className="qr-card-table">{tr('tables.tableHeading', { label: tableLabel })}</p>
      <p className="qr-card-prompt">{tr('tables.qrScanPrompt')}</p>
      {shortUrl && <p className="qr-card-short">{shortUrl}</p>}
      <p className="qr-card-attrib">{tr('tables.qrAttribution')}</p>
      {metaParts.length > 0 && <p className="qr-card-meta">{metaParts.join(' · ')}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             TableQrDialog                                  */
/* -------------------------------------------------------------------------- */

export function TableQrDialog({
  label,
  tableId,
  initialRaw,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
}: {
  label: string;
  tableId: string;
  initialRaw?: string;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [raw, setRaw] = useState<string | null>(initialRaw ?? null);
  const [rotatedVersion, setRotatedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const identityQuery = useQrIdentity(accessToken, tenantId, branchId);
  const history = useQrTokenHistory(accessToken, tenantId, branchId, tableId);

  const identity = identityQuery.data ?? null;
  const activeMeta = history.data?.find((token) => token.revokedAt === null) ?? null;
  // Prefer the refetched history entry; fall back to the rotation response so
  // the card can show its version before the refetch lands.
  const displayMeta: QrTokenMeta | null = activeMeta ?? (rotatedVersion != null ? { version: rotatedVersion } : null);
  const historyLoaded = !history.isLoading && !history.isError;

  // The raw token exists only in memory (the server keeps a hash), so the
  // ordering URL can only be built while a fresh raw token is in hand.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = raw ? buildOrderingUrl(origin, raw) : '';

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    setExportError(null);
    try {
      const response = await apiRequest<ApiEnvelope<{ raw: string; version: number }>>(
        `/branches/${branchId}/tables/${tableId}/qr-token/rotate`,
        { method: 'POST', accessToken, csrfToken, tenantId, body: {} },
      );
      setRaw(response.data.raw);
      setRotatedVersion(response.data.version ?? null);
      void history.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.qrRotateError'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function currentSvgString(): string | null {
    const svg = cardRef.current?.querySelector('.qr-code-box svg');
    if (!svg || !url) return null;
    return serializeQrSvg(svg as SVGSVGElement, url, QR_PREVIEW_SIZE);
  }

  function fileBase(): string {
    const version = displayMeta?.version;
    return `qr-${qrFileSlug(label)}${version ? `-v${version}` : ''}`;
  }

  async function downloadSvgAsset() {
    const svgString = currentSvgString();
    if (!svgString) return;
    downloadSvg(svgString, `${fileBase()}.svg`);
  }

  async function downloadPngAsset() {
    const svgString = currentSvgString();
    if (!svgString) return;
    try {
      await downloadPngFromSvg(svgString, `${fileBase()}.png`, QR_PREVIEW_SIZE);
      setExportError(null);
    } catch {
      setExportError(tr('tables.qrExportError'));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" aria-label={tr('tables.qrTitle', { label })}>
        <DialogTitle>{tr('tables.qrTitle', { label })}</DialogTitle>
        {!raw ? (
          <div className="mt-4 grid gap-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
              {tr('tables.qrRotateWarning')}
            </p>
            {historyLoaded && !activeMeta && (
              <p className="text-xs font-bold text-ink-muted">{tr('tables.qrNoActiveToken')}</p>
            )}
            {historyLoaded && activeMeta && (
              <p className="text-xs font-bold text-ink-muted">
                {[
                  tr('tables.qrTokenVersion', { version: activeMeta.version }),
                  activeMeta.createdAt
                    ? tr('tables.qrTokenCreated', { date: activeMeta.createdAt.slice(0, 10) })
                    : null,
                  tr('tables.qrTokenActive'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('common.cancel')}
              </button>
              <button type="button" onClick={generate} disabled={busy} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
                {busy ? tr('tables.qrGenerating') : tr('tables.qrGenerateBtn')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="qr-print-area grid justify-items-center gap-2 rounded-2xl border border-line bg-white p-5">
              <TableQrCard
                layout="a6"
                identity={identity}
                tableLabel={label}
                url={url}
                meta={displayMeta}
                cardRef={cardRef}
              />
            </div>
            <div>
              <p className="text-xs font-bold text-ink-muted">{tr('tables.qrUrlLabel')}</p>
              <p className="mt-1 break-all text-center text-xs text-ink-muted">{url}</p>
            </div>
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                {error}
              </div>
            )}
            {exportError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                {exportError}
              </div>
            )}
            {copied && (
              <p role="status" className="text-xs font-bold text-emerald-700">{tr('tables.qrCopied')}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={copyLink} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('tables.qrCopyBtn')}
              </button>
              <button type="button" onClick={downloadSvgAsset} data-testid="qr-download-svg" className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('tables.qrSvgBtn')}
              </button>
              <button type="button" onClick={downloadPngAsset} data-testid="qr-download-png" className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('tables.qrPngBtn')}
              </button>
              <button type="button" onClick={() => printAnchor('.qr-print-area', A6_PAGE_RULES)} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('tables.qrPrintBtn')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReplace(true)}
                disabled={busy}
                className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? tr('tables.qrGenerating') : tr('tables.qrRotateBtn')}
              </button>
              <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
                {tr('tables.qrDoneBtn')}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
      {confirmReplace && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmReplace}
          title={tr('tables.qrReplaceConfirmTitle')}
          description={tr('tables.qrReplaceConfirmBody', { label })}
          confirmLabel={tr('tables.qrReplaceConfirmBtn')}
          cancelLabel={tr('common.cancel')}
          variant="danger"
          onConfirm={() => {
            setConfirmReplace(false);
            void generate();
          }}
        />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                          TableQrBatchDialog                                */
/* -------------------------------------------------------------------------- */

export function TableQrBatchDialog({
  tables,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
}: {
  tables: { tableId: string; label: string }[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [layout, setLayout] = useState<QrLayout>('a6');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<QrTokenRotation[] | null>(null);

  const identityQuery = useQrIdentity(accessToken, tenantId, branchId);
  const allSelected = tables.length > 0 && selected.size === tables.length;

  function toggle(tableId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(tables.map((t) => t.tableId)));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<ApiEnvelope<QrTokenRotation[]>>(
        `/branches/${branchId}/tables/qr-token/rotate-batch`,
        { method: 'POST', accessToken, csrfToken, tenantId, body: { tableIds: [...selected] } },
      );
      const rotations = Array.isArray(response.data) ? response.data : [];
      if (rotations.length === 0) throw new ApiError(500, tr('tables.batchRotateError'));
      setResults(rotations);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('tables.batchRotateError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!results} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto" aria-label={tr('tables.batchQrTitle')}>
        <DialogTitle>{tr('tables.batchQrTitle')}</DialogTitle>
        <p className="mt-2 text-sm text-ink-muted">{tr('tables.batchHint')}</p>
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
          {tr('tables.qrRotateWarning')}
        </p>

        <fieldset className="mt-4">
          <legend className="text-sm font-black">{tr('tables.batchLayout')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['a6', 'sticker'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                onClick={() => setLayout(option)}
                className={`min-h-10 rounded-lg border px-4 text-xs font-black ${
                  layout === option ? 'border-dark bg-dark text-white' : 'border-line bg-white'
                }`}
              >
                {tr(option === 'a6' ? 'tables.batchLayoutA6' : 'tables.batchLayoutSticker')}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm font-black">
            {tr('tables.batchGenerateBtn', { count: selected.size })}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} data-testid="batch-select-all" />
            {tr('tables.batchSelectAll')}
          </label>
        </div>

        {tables.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{tr('tables.batchEmptyHint')}</p>
        ) : (
          <ul className="mt-2 max-h-56 divide-y overflow-y-auto rounded-xl border border-line bg-white">
            {tables.map((t) => (
              <li key={t.tableId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(t.tableId)}
                    onChange={() => toggle(t.tableId)}
                    data-testid={`batch-table-${t.label}`}
                  />
                  <span className="font-bold">{tr('tables.tableHeading', { label: t.label })}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
            {tr('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || selected.size === 0}
            data-testid="batch-generate"
            className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? tr('tables.qrGenerating') : tr('tables.batchGenerateBtn', { count: selected.size })}
          </button>
        </div>

        {confirmOpen && (
          <ConfirmDialog
            open
            onOpenChange={setConfirmOpen}
            title={tr('tables.batchConfirmTitle', { count: selected.size })}
            description={tr('tables.batchConfirmBody', { count: selected.size })}
            confirmLabel={tr('tables.batchConfirmBtn')}
            cancelLabel={tr('common.cancel')}
            variant="danger"
            onConfirm={() => {
              setConfirmOpen(false);
              void generate();
            }}
          />
        )}
      </DialogContent>

      {results && typeof document !== 'undefined' && (
        <BatchQrPreview
          rotations={results}
          layout={layout}
          onLayoutChange={setLayout}
          identity={identityQuery.data ?? null}
          onClose={() => setResults(null)}
        />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                             BatchQrPreview                                 */
/* -------------------------------------------------------------------------- */

/**
 * Full-screen print preview for generated codes, portalled to `document.body`
 * so the print stylesheet can isolate it from the app. The batch dialog stays
 * closed while this is shown so its modal lock cannot swallow toolbar clicks.
 * Raw tokens live only in this component's props until `onClose` drops them.
 */
function BatchQrPreview({
  rotations,
  layout,
  onLayoutChange,
  identity,
  onClose,
}: {
  rotations: QrTokenRotation[];
  layout: QrLayout;
  onLayoutChange: (layout: QrLayout) => void;
  identity: QrIdentity | null;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return createPortal(
    <div className="qr-print-preview" data-testid="qr-batch-preview" role="region" aria-label={tr('tables.batchPreviewAria')}>
      <div className="qr-print-toolbar">
        <p className="text-sm font-bold text-ink">{tr('tables.batchPrintNotice', { count: rotations.length })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2" role="group" aria-label={tr('tables.batchLayout')}>
            {(['a6', 'sticker'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                onClick={() => onLayoutChange(option)}
                className={`min-h-11 rounded-xl border px-4 text-xs font-black ${
                  layout === option ? 'border-dark bg-dark text-white' : 'border-line bg-white'
                }`}
              >
                {tr(option === 'a6' ? 'tables.batchLayoutA6' : 'tables.batchLayoutSticker')}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="qr-batch-print"
            onClick={() => printAnchor('.qr-print-sheet', BATCH_PAGE_RULES)}
            className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white"
          >
            {tr('tables.batchPrintBtn')}
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="qr-batch-back"
            className="min-h-11 rounded-xl border border-line bg-white px-5 text-sm font-bold"
          >
            {tr('tables.batchBackBtn')}
          </button>
        </div>
      </div>
      <div
        className={`qr-print-sheet ${layout === 'a6' ? 'qr-sheet-a6' : 'qr-sheet-sticker'}`}
        data-testid="qr-batch-sheet"
      >
        {rotations.map((r) => (
          <TableQrCard
            key={r.tableId}
            layout={layout}
            identity={identity}
            tableLabel={r.label}
            url={buildOrderingUrl(origin, r.raw)}
            meta={{ version: r.version }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
