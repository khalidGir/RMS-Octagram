'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useOnlineStatus } from './connectivity-indicator';

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
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const branchId = typeof window === 'undefined' ? '' : window.sessionStorage.getItem('rms-branch-id') ?? membership?.branchAssignments[0]?.branchId ?? '';
  const isOnline = useOnlineStatus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const queue = useQuery({
    queryKey: ['owner-payment-review', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId && membership?.role === 'OWNER'),
    queryFn: async () => (await apiRequest<ApiEnvelope<QueuePayment[]>>(`/branches/${branchId}/payments?status=PENDING_VERIFICATION&limit=50`, { accessToken, tenantId })).data,
    refetchInterval: 15_000,
  });

  const detail = useQuery({
    queryKey: ['owner-payment-detail', selectedId],
    enabled: Boolean(selectedId && accessToken),
    queryFn: async () => (await apiRequest<ApiEnvelope<PaymentDetail>>(`/branches/${branchId}/payments/${selectedId}`, { accessToken, tenantId })).data,
  });

  useEffect(() => {
    if (!selectedId && queue.data?.[0]) setSelectedId(queue.data[0].id);
  }, [queue.data, selectedId]);

  useEffect(() => {
    setProofUrl(null);
    setReviewNote('');
    setRejecting(false);
    setReason('');
    setConfirmApprove(false);
  }, [selectedId]);

  const proofTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProof = useCallback(async () => {
    if (!selectedId) return;
    setMessage(null);
    try {
      const response = await apiRequest<ApiEnvelope<{ url: string; expiresIn: number }>>(`/branches/${branchId}/payments/${selectedId}/proof-url`, { accessToken, tenantId });
      setProofUrl(response.data.url);
      if (proofTimerRef.current) clearTimeout(proofTimerRef.current);
      proofTimerRef.current = setTimeout(() => setProofUrl(null), Math.max(1, response.data.expiresIn - 5) * 1000);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Proof is unavailable.');
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
      setSelectedId(null);
      setProofUrl(null);
      setConfirmApprove(false);
      await queue.refetch();
      setMessage('Payment verified. The order was released to the kitchen and stock was posted once.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([queue.refetch(), detail.refetch()]);
        setMessage('Another Owner already changed this payment. The current authoritative state has been refreshed.');
      } else {
        setMessage(error instanceof ApiError ? error.message : 'The decision was not saved.');
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
      setSelectedId(null);
      setProofUrl(null);
      setRejecting(false);
      await queue.refetch();
      setMessage('Payment rejected. The customer will see safe guidance to ask staff.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await Promise.all([queue.refetch(), detail.refetch()]);
        setMessage('Another Owner already changed this payment. The current authoritative state has been refreshed.');
      } else {
        setMessage(error instanceof ApiError ? error.message : 'The decision was not saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (membership?.role !== 'OWNER') return <State title="Permission denied" detail="Only the restaurant Owner can review transfer proofs." />;
  if (queue.isLoading) return <State title="Loading payment reviews…" detail="Retrieving the current Owner queue." />;
  if (queue.isError) return <State title="Review queue unavailable" detail="Check the connection and retry." retry={() => void queue.refetch()} />;

  const payment = detail.data;

  return (
    <>
      <header className="mb-7">
        <p className="text-xs font-black uppercase tracking-wider text-brand">Owner only</p>
        <h1 className="mt-2 text-3xl font-black">Transfer payment review</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          A screenshot is evidence to inspect, not external account verification. Approval releases the kitchen and posts stock once.
        </p>
      </header>

      {message && (
        <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          {message}
        </div>
      )}

      {!queue.data?.length ? (
        <State title="No payments awaiting review" detail="New Bank and Telebirr submissions will appear here." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <aside className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            {queue.data.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full p-5 text-left ${selectedId === item.id ? 'bg-orange-50' : ''}`}
              >
                <div className="flex justify-between gap-3">
                  <b>Order #{item.order?.orderNumber}</b>
                  <span className="text-xs font-black text-amber-800">{item.method.replace('_', ' ')}</span>
                </div>
                <p className="mt-2 text-lg font-black">{formatEtbMinor(item.amountMinor)}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {item.order?.customerName ?? 'Customer'} · {new Date(item.submittedAt ?? item.createdAt).toLocaleString()}
                </p>
              </button>
            ))}
          </aside>

          <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
            {detail.isLoading || !payment ? (
              <p className="text-sm text-ink-muted">Loading payment details…</p>
            ) : (
              <>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-brand">ORDER #{payment.order?.orderNumber}</p>
                    <h2 className="mt-1 text-2xl font-black">{formatEtbMinor(payment.amountMinor)}</h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {payment.method.replace('_', ' ')} · submitted {new Date(payment.submittedAt ?? payment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="h-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">Awaiting review</span>
                </div>

                <div className="mt-5">
                  <button
                    onClick={loadProof}
                    disabled={proofUrl !== null}
                    className="min-h-10 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-gray-50"
                  >
                    {proofUrl ? 'Loading proof…' : 'View payment proof'}
                  </button>
                  {proofUrl && (
                    <div className="mt-3">
                      <img
                        src={proofUrl}
                        alt="Payment proof screenshot"
                        className="max-h-96 rounded-xl border border-line object-contain"
                      />
                      <p className="mt-2 text-xs text-ink-muted">Proof URL expires automatically. Never save or cache this image.</p>
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <label className="text-xs font-bold text-ink-muted">Review note (optional)</label>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value.slice(0, 500))}
                    placeholder="Private note about this verification…"
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
                        Verify payment
                      </button>
                      <button
                        onClick={() => setRejecting(true)}
                        disabled={busy}
                        className="min-h-11 rounded-xl border border-red-200 bg-white px-6 font-bold text-red-700 hover:bg-red-50"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <div className="w-full">
                      <label className="text-xs font-bold text-red-700">Rejection reason (required)</label>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 255))}
                        placeholder="Why this payment is rejected…"
                        className="mt-1 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm"
                        autoFocus
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={performReject}
                          disabled={busy || !reason.trim() || !isOnline}
                          className="min-h-10 rounded-xl bg-red-600 px-4 text-sm font-black text-white disabled:opacity-50"
                        >
                          Confirm rejection
                        </button>
                        <button
                          onClick={() => { setRejecting(false); setReason(''); }}
                          disabled={busy}
                          className="min-h-10 rounded-xl border border-line bg-white px-4 text-sm font-bold"
                        >
                          Cancel
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
          amount={formatEtbMinor(payment.amountMinor)}
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-label="Confirm payment verification">
      <div ref={dialogRef} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-black">Verify payment</h2>
        <div className="mt-4 space-y-2 text-sm">
          <p><span className="font-bold text-ink-muted">Order:</span> #{orderNumber}</p>
          <p><span className="font-bold text-ink-muted">Method:</span> {method.replace('_', ' ')}</p>
          <p><span className="font-bold text-ink-muted">Amount:</span> <span className="font-black">{amount}</span></p>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
          A screenshot is evidence to inspect, not external account verification. Confirming releases the kitchen and posts inventory once. This action cannot be undone.
        </div>
        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl border border-line bg-white font-bold"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !isOnline}
            className="min-h-11 flex-1 rounded-xl bg-emerald-600 font-black text-white disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Confirm verification'}
          </button>
        </div>
      </div>
    </div>
  );
}

function State({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return (
    <section className="grid min-h-64 place-items-center rounded-2xl border border-line bg-white p-6 text-center">
      <div>
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{detail}</p>
        {retry && (
          <button onClick={retry} className="mt-4 min-h-11 rounded-xl bg-[#18241f] px-5 font-black text-white">
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
