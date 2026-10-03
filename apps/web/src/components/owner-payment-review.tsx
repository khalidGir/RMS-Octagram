'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useLocale } from '@/components/locale-provider';
import { labelFor, paymentMethodKeys } from '@/lib/status-labels';
import { useAuth } from './auth-provider';
import { useBranch } from './shell/branch-provider';
import { useOnlineStatus } from '@/hooks';

interface QueuePayment {
  id: string;
  method: string;
  status: string;
  amountMinor: string;
  customerReference: string | null;
  submittedAt: string | null;
  createdAt: string;
  order?: { orderNumber: string; totalMinor: string; customerName: string | null; status: string };
  proofs: Array<{ scanStatus: string; isCurrent: boolean }>;
}

interface PaymentDetail extends QueuePayment {
  reviewedAt: string | null;
  version: number;
  proofs: Array<{ scanStatus: string; isCurrent: boolean; contentType: string; sizeBytes: string }>;
}

export function OwnerPaymentReview() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr, formatDate } = useLocale();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const { branchId } = useBranch();
  const isOnline = useOnlineStatus();

  const [selected, setSelected] = useState<{ branchId: string; id: string } | null>(null);
  // A selection made on another branch is not valid here, so it never fetches
  // (or renders) a payment under the wrong branch URL.
  const selectedId = selected && selected.branchId === branchId ? selected.id : null;
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const proofTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queue = useQuery({
    queryKey: ['owner-payment-review', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId && membership?.role === 'OWNER'),
    queryFn: async () => (await apiRequest<ApiEnvelope<QueuePayment[]>>(`/branches/${branchId}/payments?status=PENDING_VERIFICATION&limit=50`, { accessToken, tenantId })).data,
    refetchInterval: 15_000,
  });

  const detail = useQuery({
    queryKey: ['owner-payment-detail', branchId, selectedId],
    enabled: Boolean(selectedId && accessToken && branchId),
    queryFn: async () => (await apiRequest<ApiEnvelope<PaymentDetail>>(`/branches/${branchId}/payments/${selectedId}`, { accessToken, tenantId })).data,
  });

  useEffect(() => {
    if ((!selected || selected.branchId !== branchId) && queue.data?.[0]) {
      setSelected({ branchId, id: queue.data[0].id });
    }
  }, [queue.data, selected, branchId]);

  useEffect(() => {
    setProofUrl(null);
    setReviewNote('');
    setRejecting(false);
    setReason('');
    setConfirmApprove(false);
    if (proofTimerRef.current) clearTimeout(proofTimerRef.current);
  }, [selectedId]);

  const loadProof = useCallback(async () => {
    if (!selectedId) return;
    setMessage(null);
    try {
      const response = await apiRequest<ApiEnvelope<{ url: string; expiresIn: number }>>(`/branches/${branchId}/payments/${selectedId}/proof-url`, { accessToken, tenantId });
      setProofUrl(response.data.url);
      if (proofTimerRef.current) clearTimeout(proofTimerRef.current);
      proofTimerRef.current = setTimeout(() => setProofUrl(null), Math.max(1, response.data.expiresIn - 5) * 1000);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : tr('payments.proofUnavailable'));
    }
  }, [selectedId, accessToken, tenantId, branchId]);

  useEffect(() => {
    return () => { if (proofTimerRef.current) clearTimeout(proofTimerRef.current); };
  }, []);

  async function performApprove() {
    if (!selectedId || !isOnline) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/branches/${branchId}/payments/${selectedId}/approve`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { reviewNote: reviewNote.trim() || undefined },
      });
      setSelected(null);
      setProofUrl(null);
      setConfirmApprove(false);
      await queue.refetch();
      setMessage(tr('payments.verifiedMsg'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([queue.refetch(), detail.refetch()]);
        setMessage(tr('payments.conflictMsg'));
      } else {
        setMessage(error instanceof ApiError ? error.message : tr('payments.decisionNotSaved'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function performReject() {
    if (!selectedId || !reason.trim() || !isOnline) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/branches/${branchId}/payments/${selectedId}/reject`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { reason: reason.trim() },
      });
      setSelected(null);
      setProofUrl(null);
      setRejecting(false);
      await queue.refetch();
      setMessage(tr('payments.rejectedMsg'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([queue.refetch(), detail.refetch()]);
        setMessage(tr('payments.conflictMsg'));
      } else {
        setMessage(error instanceof ApiError ? error.message : tr('payments.decisionNotSaved'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (membership?.role !== 'OWNER') return <State title={tr('payments.permissionTitle')} detail={tr('payments.permissionDetail')} />;
  if (queue.isLoading) return <State title={tr('payments.loadingTitle')} detail={tr('payments.loadingDetail')} />;
  if (queue.isError) return <State title={tr('payments.queueErrorTitle')} detail={tr('payments.queueErrorDetail')} retry={() => void queue.refetch()} />;

  const payment = detail.data;

  return (
    <>
      <header className="mb-7">
        <p className="text-xs font-black uppercase tracking-wider text-brand">{tr('payments.ownerEyebrow')}</p>
        <h1 className="mt-2 text-3xl font-black">{tr('payments.pageTitle')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          {tr('payments.pageDescription')}
        </p>
      </header>

      {message && (
        <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </div>
      )}

      {!queue.data?.length ? (
        <State title={tr('payments.emptyTitle')} detail={tr('payments.emptyDetail')} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <aside className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            {queue.data.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected({ branchId, id: item.id })}
                className={`w-full p-5 text-start ${selectedId === item.id ? 'bg-orange-50' : ''}`}
              >
                <div className="flex justify-between gap-3">
                  <b>{tr('payments.orderNumberPrefix', { n: item.order?.orderNumber ?? '' })}</b>
                  <span className="text-xs font-black text-amber-800">{labelFor(paymentMethodKeys, item.method, tr)}</span>
                </div>
                <p className="mt-2 text-lg font-black">{formatCurrency(item.amountMinor)}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {item.order?.customerName ?? tr('payments.customerFallback')} · {formatDate(item.submittedAt ?? item.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                </p>
              </button>
            ))}
          </aside>

          <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
            {detail.isLoading || !payment ? (
              <p className="text-sm text-ink-muted">{tr('payments.loadingDetails')}</p>
            ) : (
              <>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-brand">{tr('payments.orderPrefixUpper', { n: payment.order?.orderNumber ?? '' })}</p>
                    <h2 className="mt-1 text-2xl font-black">{formatCurrency(payment.amountMinor)}</h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {labelFor(paymentMethodKeys, payment.method, tr)} · {tr('payments.submittedSuffix', { date: formatDate(payment.submittedAt ?? payment.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) })}
                    </p>
                  </div>
                  <span className="h-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{tr('payments.awaitingReview')}</span>
                </div>

                <div className="mt-5">
                  <button
                    onClick={loadProof}
                    disabled={proofUrl !== null}
                    className="min-h-10 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-gray-50"
                  >
                    {proofUrl ? tr('payments.loadingProof') : tr('payments.viewProof')}
                  </button>
                  {proofUrl && (
                    <div className="mt-3">
                      <img
                        src={proofUrl}
                        alt={tr('payments.proofAlt')}
                        className="max-h-96 rounded-xl border border-line object-contain"
                      />
                      <p className="mt-2 text-xs text-ink-muted">{tr('payments.proofExpiryNote')}</p>
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <label className="text-xs font-bold text-ink-muted">{tr('payments.reviewNote')}</label>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value.slice(0, 500))}
                    placeholder={tr('payments.reviewNotePlaceholder')}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div className="mt-5 flex gap-3">
                  {!rejecting ? (
                    <>
                      <button
                        onClick={() => setConfirmApprove(true)}
                        disabled={busy || !isOnline}
                        className="min-h-11 rounded-xl bg-emerald-600 px-6 font-black text-white disabled:opacity-50"
                      >
                        {tr('payments.verifyPayment')}
                      </button>
                      <button
                        onClick={() => setRejecting(true)}
                        disabled={busy}
                        className="min-h-11 rounded-xl border border-red-200 bg-white px-6 font-bold text-red-700 hover:bg-red-50"
                      >
                        {tr('payments.reject')}
                      </button>
                    </>
                  ) : (
                    <div className="w-full">
                      <label className="text-xs font-bold text-red-700">{tr('payments.rejectionReason')}</label>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 255))}
                        placeholder={tr('payments.rejectionPlaceholder')}
                        className="mt-1 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm"
                        autoFocus
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={performReject}
                          disabled={busy || !reason.trim() || !isOnline}
                          className="min-h-10 rounded-xl bg-red-600 px-4 text-sm font-black text-white disabled:opacity-50"
                        >
                          {tr('payments.confirmRejection')}
                        </button>
                        <button
                          onClick={() => { setRejecting(false); setReason(''); }}
                          disabled={busy}
                          className="min-h-10 rounded-xl border border-line bg-white px-4 text-sm font-bold"
                        >
                          {tr('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {confirmApprove && payment && (
        <ApproveDialog
          orderNumber={payment.order?.orderNumber ?? '?'}
          method={payment.method}
          amount={formatCurrency(payment.amountMinor)}
          busy={busy}
          isOnline={isOnline}
          onConfirm={performApprove}
          onCancel={() => setConfirmApprove(false)}
        />
      )}
    </>
  );
}

function ApproveDialog({
  orderNumber,
  method,
  amount,
  busy,
  isOnline,
  onConfirm,
  onCancel,
}: {
  orderNumber: string;
  method: string;
  amount: string;
  busy: boolean;
  isOnline: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { tr } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelRef.current?.focus();

    const root = document.getElementById('__next');
    if (root) root.inert = true;

    const dialog = dialogRef.current;
    if (!dialog) return;

    function getFocusable(): HTMLElement[] {
      return Array.from(dialog!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (root) root.inert = false;
      previousFocusRef.current?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label={tr('payments.confirmApproveAria')}>
      <div ref={dialogRef} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">{tr('payments.approveTitle')}</h2>
        <div className="mt-4 space-y-2 text-sm">
          <p><span className="font-bold text-ink-muted">{tr('payments.orderLabel')}</span> #{orderNumber}</p>
          <p><span className="font-bold text-ink-muted">{tr('payments.methodLabel')}</span> {labelFor(paymentMethodKeys, method, tr)}</p>
          <p><span className="font-bold text-ink-muted">{tr('payments.amountLabel')}</span> <span className="font-black">{amount}</span></p>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
          {tr('payments.approveWarning')}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl border border-line bg-white font-bold"
          >
            {tr('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !isOnline}
            className="min-h-11 flex-1 rounded-xl bg-emerald-600 font-black text-white disabled:opacity-50"
          >
            {busy ? tr('payments.verifying') : tr('payments.confirmVerification')}
          </button>
        </div>
      </div>
    </div>
  );
}

function State({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  const { tr } = useLocale();
  return (
    <section className="grid min-h-64 place-items-center rounded-2xl border border-line bg-white p-6 text-center">
      <div>
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{detail}</p>
        {retry && (
          <button onClick={retry} className="mt-4 min-h-11 rounded-xl bg-dark px-5 font-black text-white">
            {tr('common.tryAgain')}
          </button>
        )}
      </div>
    </section>
  );
}
