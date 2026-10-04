'use client';

import { useState } from 'react';
import { apiRequest, ApiError, type ApiEnvelope } from '@/lib/api-client';
import { downloadBlob } from '@/lib/qr-export';
import { escapeReceiptHtml, safeReceiptFilename, type ReceiptData } from '@/lib/receipt';
import { useLocale } from '@/components/locale-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function ReceiptButton({
  endpoint,
  accessToken,
  tenantId,
  label,
}: {
  endpoint: string;
  accessToken?: string | null;
  tenantId?: string;
  label: string;
}) {
  const { tr } = useLocale();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openReceipt() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<ApiEnvelope<ReceiptData>>(endpoint, { accessToken: accessToken ?? undefined, tenantId });
      setReceipt(response.data);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409 ? tr('orders.receiptNotSettled') : tr('orders.receiptLoadFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void openReceipt()} disabled={busy} className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-black disabled:opacity-50">
        {busy ? tr('orders.receiptLoading') : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm font-bold text-danger">{error}</p>}
      {receipt && <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

export function ReceiptDialog({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const { tr, formatCurrency, formatDate, locale, direction } = useLocale();

  function printReceipt() {
    document.body.classList.add('rms-receipt-printing');
    const cleanup = () => {
      document.body.classList.remove('rms-receipt-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  function downloadReceipt() {
    const rows = receipt.lines.map((line) => `<tr><td>${escapeReceiptHtml(`${line.quantity} × ${line.itemName}${line.variantName ? ` (${line.variantName})` : ''}`)}</td><td>${escapeReceiptHtml(formatCurrency(line.lineTotalMinor))}</td></tr>`).join('');
    const html = `<!doctype html><html lang="${locale}" dir="${direction}"><meta charset="utf-8"><title>${escapeReceiptHtml(receipt.receiptNumber)}</title><style>body{font:14px system-ui;max-width:680px;margin:40px auto;color:#17211d}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ddd}td:last-child{text-align:end}.total{font-size:18px;font-weight:700}.note{margin-top:24px;color:#666;font-size:12px}</style><body><h1>${escapeReceiptHtml(receipt.restaurantName)}</h1><p>${escapeReceiptHtml(receipt.branchName)} · ${escapeReceiptHtml(receipt.receiptNumber)}</p><p>${escapeReceiptHtml(formatDate(receipt.settledAt, { dateStyle: 'medium', timeStyle: 'short' }))}</p><table>${rows}<tr><td>${escapeReceiptHtml(tr('orders.receiptSubtotal'))}</td><td>${escapeReceiptHtml(formatCurrency(receipt.subtotalMinor))}</td></tr><tr><td>${escapeReceiptHtml(tr('orders.receiptTax'))}</td><td>${escapeReceiptHtml(formatCurrency(receipt.taxMinor))}</td></tr><tr class="total"><td>${escapeReceiptHtml(tr('orders.receiptTotal'))}</td><td>${escapeReceiptHtml(formatCurrency(receipt.totalMinor))}</td></tr></table><p>${escapeReceiptHtml(tr('orders.receiptPayment', { method: receipt.payment.method }))}</p><p class="note">${escapeReceiptHtml(tr('orders.receiptNonFiscal'))}</p></body></html>`;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeReceiptFilename(receipt.receiptNumber));
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" aria-label={tr('orders.receiptTitle')}>
        <DialogTitle>{tr('orders.receiptTitle')}</DialogTitle>
        <article className="receipt-print-area mt-4 rounded-2xl border border-line bg-white p-5 text-ink">
          <header className="text-center">
            <h2 className="text-2xl font-black">{receipt.restaurantName}</h2>
            <p className="text-sm text-ink-muted">{receipt.branchName}</p>
            <p className="mt-2 font-mono text-xs">{receipt.receiptNumber}</p>
            <p className="text-xs text-ink-muted">{formatDate(receipt.settledAt, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </header>
          <div className="mt-5 border-y border-line py-3 text-sm">
            <p>{tr('orders.receiptOrder', { number: receipt.orderNumber })}</p>
            {receipt.tableLabel && <p>{tr('orders.receiptTable', { table: receipt.tableLabel })}</p>}
          </div>
          <div className="divide-y divide-line">
            {receipt.lines.map((line, index) => (
              <div key={`${line.itemName}-${index}`} className="py-3 text-sm">
                <div className="flex justify-between gap-4"><span className="font-bold">{line.quantity} × {line.itemName}{line.variantName ? ` (${line.variantName})` : ''}</span><span dir="ltr">{formatCurrency(line.lineTotalMinor)}</span></div>
                {line.modifiers.map((modifier, modifierIndex) => <p key={`${modifier.name}-${modifierIndex}`} className="mt-1 text-xs text-ink-muted">+ {modifier.name}{Number(modifier.totalDeltaMinor) ? ` · ${formatCurrency(modifier.totalDeltaMinor)}` : ''}</p>)}
              </div>
            ))}
          </div>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <ReceiptAmount label={tr('orders.receiptSubtotal')} value={formatCurrency(receipt.subtotalMinor)} />
            {Number(receipt.taxMinor) > 0 && <ReceiptAmount label={tr('orders.receiptTax')} value={formatCurrency(receipt.taxMinor)} />}
            {Number(receipt.discountMinor) > 0 && <ReceiptAmount label={tr('orders.receiptDiscount')} value={`-${formatCurrency(receipt.discountMinor)}`} />}
            <ReceiptAmount label={tr('orders.receiptTotal')} value={formatCurrency(receipt.totalMinor)} strong />
          </dl>
          <p className="mt-4 text-sm">{tr('orders.receiptPayment', { method: receipt.payment.method })}</p>
          {receipt.payment.reference && <p className="break-all text-xs text-ink-muted">{tr('orders.receiptReference', { reference: receipt.payment.reference })}</p>}
          <p className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">{tr('orders.receiptNonFiscal')}</p>
        </article>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={downloadReceipt} className="min-h-11 rounded-xl border border-line px-4 text-sm font-black">{tr('orders.receiptDownload')}</button>
          <button type="button" onClick={printReceipt} className="min-h-11 rounded-xl bg-dark px-4 text-sm font-black text-white">{tr('orders.receiptPrint')}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptAmount({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 ${strong ? 'border-t border-line pt-3 text-lg font-black' : ''}`}><dt>{label}</dt><dd dir="ltr">{value}</dd></div>;
}
