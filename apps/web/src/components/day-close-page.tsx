'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { formatEtbMinor } from '@/lib/money';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { useOnlineStatus } from '@/hooks';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';

interface ShiftReportRow {
  cashShiftId: string;
  cashierUserId: string;
  openingCashMinor: number;
  approvedCashMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  varianceMinor: number;
  paymentCount: number;
  orderCount: number;
  cancellationCount: number;
  voidCount: number;
}

interface DayClosePreview {
  localBusinessDate: string;
  branchTimezone: string;
  businessDayCutoffLocal: string;
  utcStart: string;
  utcEnd: string;
  shiftReports: ShiftReportRow[];
  openShifts: Array<{ id: string; cashierUserId: string; openedAt: string }>;
  paymentTotals: {
    cash: { approvedMinor: number; pendingMinor: number; count: number };
    bankTransfer: { approvedMinor: number; pendingMinor: number; count: number };
    telebirr: { approvedMinor: number; pendingMinor: number; count: number };
    manualTransfer: { pendingVerificationMinor: number; count: number };
  };
  orderTotals: {
    confirmed: { count: number; totalMinor: number };
    cancelled: { count: number; totalMinor: number };
    voided: { count: number; totalMinor: number };
    pendingPayment: { count: number; totalMinor: number };
  };
  blockers: string[];
  status: 'READY' | 'BLOCKED' | 'ALREADY_CLOSED';
}

interface DayCloseSnapshot {
  localBusinessDate: string;
  branchTimezone: string;
  businessDayCutoffLocal: string;
  closedAt: string;
  closedWithException: boolean;
  reason: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  expectedCashMinor: number;
  countedCashMinor: number;
  cashVarianceMinor: number;
  bankTransferTotalMinor: number;
  bankTransferCount: number;
  telebirrTotalMinor: number;
  telebirrCount: number;
  recognizedSalesMinor: number;
  recognizedSalesCount: number;
  cancelledTotalMinor: number;
  cancelledCount: number;
  voidedTotalMinor: number;
  voidedCount: number;
  pendingPaymentTotalMinor: number;
  pendingPaymentCount: number;
  pendingManualTransferMinor: number;
  pendingManualTransferCount: number;
  inventoryExceptions: string[];
}

interface CloseRecord {
  close: {
    id: string;
    status: string;
    closedWithException: boolean;
    reason: string | null;
    closedAt: string;
    reopenedAt: string | null;
    reopenReason: string | null;
    version: number;
  };
  snapshot: DayCloseSnapshot | null;
}

function formatInTz(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function DayClosePage() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { branchId } = useBranch();
  const online = useOnlineStatus();
  const membership = profile?.memberships?.[0];
  const tenantId = membership?.tenant.id ?? '';
  const role = membership?.role ?? '';
  const isOwner = role === 'OWNER';
  const allowed = role === 'OWNER' || role === 'MANAGER';

  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exception, setException] = useState(false);
  const [reason, setReason] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const dateQuery = date ? `?localBusinessDate=${encodeURIComponent(date)}` : '';
  const enabled = Boolean(accessToken && tenantId && branchId && allowed);

  const previewQuery = useQuery({
    queryKey: ['day-close-preview', tenantId, branchId, date],
    enabled,
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<DayClosePreview>>(
        `/branches/${branchId}/day-close/preview${dateQuery}`,
        { accessToken, tenantId },
      )).data,
  });
  const currentQuery = useQuery({
    queryKey: ['day-close-current', tenantId, branchId, date],
    enabled,
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<CloseRecord | null>>(
        `/branches/${branchId}/day-close/current${dateQuery}`,
        { accessToken, tenantId },
      )).data,
  });

  const preview = previewQuery.data;
  const record = currentQuery.data;
  const closedSnapshot = record?.close.status === 'CLOSED' && record.snapshot ? record.snapshot : null;
  const reopened = record?.close.status === 'REOPENED' ? record.close : null;

  async function closeDay(withException: boolean) {
    const effectiveReason = reason.trim();
    if (withException && !effectiveReason) return setMessage('Explain why you are closing with an exception.');
    if (!online) return setMessage('You are offline. Reconnect before closing the business day.');
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/branches/${branchId}/day-close/close${dateQuery}`, {
        method: 'POST',
        body: withException ? { closedWithException: true, reason: effectiveReason } : {},
        accessToken,
        csrfToken,
        tenantId,
      });
      setReason('');
      setException(false);
      await Promise.all([previewQuery.refetch(), currentQuery.refetch()]);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not close the business day.');
      await previewQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function reopenDay() {
    const effectiveReason = reopenReason.trim();
    if (!effectiveReason) return setMessage('A reason is required to reopen the business day.');
    if (!online) return setMessage('You are offline. Reconnect before reopening the business day.');
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/branches/${branchId}/day-close/reopen${dateQuery}`, {
        method: 'POST',
        body: { reason: effectiveReason },
        accessToken,
        csrfToken,
        tenantId,
      });
      setReopenReason('');
      setReopenOpen(false);
      await Promise.all([previewQuery.refetch(), currentQuery.refetch()]);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not reopen the business day.');
      await currentQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (!membership || !allowed) {
    return <State title="Permission denied" detail="This page is available to owners and managers only." />;
  }
  if (previewQuery.isLoading || currentQuery.isLoading) {
    return <State title="Loading business day…" detail="Retrieving reconciliation totals for this branch." />;
  }
  if (previewQuery.isError || currentQuery.isError) {
    return (
      <State
        title="Business day unavailable"
        detail="Reconnect and try again."
        retry={() => {
          void previewQuery.refetch();
          void currentQuery.refetch();
        }}
      />
    );
  }
  if (!preview) return <State title="Business day unavailable" detail="No reconciliation data returned." />;

  if (closedSnapshot) {
    return (
      <>
        <Header
          dateValue={closedSnapshot.localBusinessDate}
          onDateChange={(value) => {
            setDate(value);
            setMessage(null);
            setReopenOpen(false);
          }}
          preview={preview}
        />
        {message && <Alert>{message}</Alert>}
        <ClosedSnapshot
          snapshot={closedSnapshot}
          record={record!}
          tz={preview.branchTimezone}
          isOwner={isOwner}
          online={online}
          busy={busy}
          reopenOpen={reopenOpen}
          reopenReason={reopenReason}
          onReopenReasonChange={setReopenReason}
          onToggleReopen={() => {
            setReopenOpen((v) => !v);
            setMessage(null);
            setReopenReason('');
          }}
          onReopen={() => void reopenDay()}
        />
      </>
    );
  }

  return (
    <>
      <Header
        dateValue={date || preview.localBusinessDate}
        onDateChange={(value) => {
          setDate(value);
          setMessage(null);
          setException(false);
          setReason('');
        }}
        preview={preview}
      />
      {message && <Alert>{message}</Alert>}
      {reopened && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          This business day was reopened{reopened.reopenReason ? `: ${reopened.reopenReason}` : '.'} Close it again when the
          missing entries are added.
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {preview.status === 'BLOCKED' ? (
          <StatusChip status="danger">Blocked</StatusChip>
        ) : preview.status === 'ALREADY_CLOSED' ? (
          <StatusChip status="info">Already closed</StatusChip>
        ) : (
          <StatusChip status="success">Ready to close</StatusChip>
        )}
        <span className="text-sm text-ink-muted">
          {preview.branchTimezone} · business day starts at {preview.businessDayCutoffLocal}
        </span>
      </div>

      {preview.blockers.length > 0 && (
        <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-black text-red-800">Must be resolved before a normal close</h2>
          <ul className="mt-2 list-disc pl-5 text-sm font-semibold text-red-800">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Recognised sales" value={preview.orderTotals.confirmed.totalMinor} detail={`${preview.orderTotals.confirmed.count} orders`} />
        <Stat label="Cash approved" value={preview.paymentTotals.cash.approvedMinor} detail={`${preview.paymentTotals.cash.count} payments`} />
        <Stat label="Bank transfer approved" value={preview.paymentTotals.bankTransfer.approvedMinor} detail={`${preview.paymentTotals.bankTransfer.count} payments`} />
        <Stat label="Telebirr approved" value={preview.paymentTotals.telebirr.approvedMinor} detail={`${preview.paymentTotals.telebirr.count} payments`} />
        <Stat label="Cancelled orders" value={preview.orderTotals.cancelled.totalMinor} detail={`${preview.orderTotals.cancelled.count} orders`} />
        <Stat label="Voided orders" value={preview.orderTotals.voided.totalMinor} detail={`${preview.orderTotals.voided.count} orders`} />
        <Stat
          label="Pending payments"
          value={preview.orderTotals.pendingPayment.totalMinor}
          detail={`${preview.orderTotals.pendingPayment.count} orders awaiting payment`}
        />
        <Stat
          label="Manual transfers to verify"
          value={preview.paymentTotals.manualTransfer.pendingVerificationMinor}
          detail={`${preview.paymentTotals.manualTransfer.count} transfers`}
        />
      </div>

      {preview.shiftReports.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-card">
          <h2 className="text-lg font-black">Closed cash shifts</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
                  <th className="py-2 pr-4 font-bold">Shift</th>
                  <th className="py-2 pr-4 font-bold">Opening</th>
                  <th className="py-2 pr-4 font-bold">Expected</th>
                  <th className="py-2 pr-4 font-bold">Counted</th>
                  <th className="py-2 pr-4 font-bold">Variance</th>
                  <th className="py-2 pr-4 font-bold">Payments</th>
                  <th className="py-2 font-bold">Orders</th>
                </tr>
              </thead>
              <tbody>
                {preview.shiftReports.map((row, index) => (
                  <tr key={row.cashShiftId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-4 font-bold">Shift {index + 1}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(row.openingCashMinor)}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(row.expectedCashMinor)}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(row.countedCashMinor)}</td>
                    <td className={`py-2 pr-4 tabular-nums font-bold ${row.varianceMinor !== 0 ? 'text-red-700' : ''}`}>
                      {formatEtbMinor(row.varianceMinor)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{row.paymentCount}</td>
                    <td className="py-2 tabular-nums">{row.orderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-6 max-w-2xl rounded-2xl border border-line bg-white p-6 shadow-card">
        <h2 className="text-xl font-black">Close the business day</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Closing freezes the day&apos;s totals into an immutable report that can be printed later.
        </p>

        {!isOwner ? (
          <p className="mt-4 rounded-xl bg-muted p-4 text-sm font-bold">
            Only the Owner can close or reopen the business day. You can review every total on this page.
          </p>
        ) : (
          <div className="mt-4">
            {preview.status === 'BLOCKED' && (
              <label className="flex items-start gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={exception}
                  onChange={(event) => {
                    setException(event.target.checked);
                    setMessage(null);
                    if (!event.target.checked) setReason('');
                  }}
                  className="mt-1 size-4"
                />
                <span>Close with exception anyway (blockers stay documented in the snapshot)</span>
              </label>
            )}
            {exception && (
              <label className="mt-4 block text-sm font-black">
                Why are you closing while blocked?
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Required, up to 500 characters"
                  className="mt-2 min-h-24 w-full rounded-xl border border-line p-3 font-normal"
                />
              </label>
            )}
            {(preview.status === 'READY' || exception) && (
              <Button
                className="mt-5"
                variant={exception ? 'danger' : 'primary'}
                loading={busy}
                disabled={!online || (exception && !reason.trim())}
                onClick={() => void closeDay(exception)}
              >
                {exception ? 'Close with exception' : 'Close business day'}
              </Button>
            )}
            {preview.status === 'BLOCKED' && !exception && (
              <p className="mt-4 text-sm text-ink-muted">
                Resolve the items above, or close with a documented exception.
              </p>
            )}
            {!online && (
              <p className="mt-4 text-sm font-bold text-red-700">Offline — closing is disabled until the server reconnects.</p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function Header({
  dateValue,
  onDateChange,
  preview,
}: {
  dateValue: string;
  onDateChange: (value: string) => void;
  preview: DayClosePreview;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-brand">Money</p>
        <h1 className="mt-2 text-3xl font-black">Day close</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Reconcile cash, payments and orders for one business day, then freeze the totals.
        </p>
      </div>
      <label className="text-sm font-black">
        Business date
        <input
          type="date"
          value={dateValue}
          onChange={(event) => onDateChange(event.target.value)}
          className="mt-2 block min-h-11 rounded-xl border border-line bg-white px-4 font-normal"
        />
        <span className="mt-1 block text-xs font-normal text-ink-muted">
          {preview.branchTimezone} · cutoff {preview.businessDayCutoffLocal}
        </span>
      </label>
    </header>
  );
}

function ClosedSnapshot({
  snapshot,
  record,
  tz,
  isOwner,
  online,
  busy,
  reopenOpen,
  reopenReason,
  onReopenReasonChange,
  onToggleReopen,
  onReopen,
}: {
  snapshot: DayCloseSnapshot;
  record: CloseRecord;
  tz: string;
  isOwner: boolean;
  online: boolean;
  busy: boolean;
  reopenOpen: boolean;
  reopenReason: string;
  onReopenReasonChange: (value: string) => void;
  onToggleReopen: () => void;
  onReopen: () => void;
}) {
  function download() {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `day-close-${snapshot.localBusinessDate}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Business day closed</p>
        <StatusChip status="success">Closed</StatusChip>
        {snapshot.closedWithException && <StatusChip status="warning">Closed with exception</StatusChip>}
        {record.close.status === 'REOPENED' && <StatusChip status="info">Reopened</StatusChip>}
      </div>
      <h1 className="mt-2 text-3xl font-black">{snapshot.localBusinessDate}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Closed {formatInTz(snapshot.closedAt, tz)} in {tz}.
      </p>
      {snapshot.closedWithException && snapshot.reason && (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <b>Exception reason:</b> {snapshot.reason}
        </p>
      )}
      {record.close.status === 'REOPENED' && record.close.reopenReason && (
        <p className="mt-4 rounded-xl bg-muted p-4 text-sm">
          <b>Reopened:</b> {record.close.reopenReason}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Recognised sales" value={snapshot.recognizedSalesMinor} detail={`${snapshot.recognizedSalesCount} orders`} />
        <Stat label="Expected cash" value={snapshot.expectedCashMinor} />
        <Stat label="Counted cash" value={snapshot.countedCashMinor} />
        <Stat label="Cash variance" value={snapshot.cashVarianceMinor} danger={snapshot.cashVarianceMinor !== 0} />
        <Stat label="Bank transfers" value={snapshot.bankTransferTotalMinor} detail={`${snapshot.bankTransferCount} payments`} />
        <Stat label="Telebirr" value={snapshot.telebirrTotalMinor} detail={`${snapshot.telebirrCount} payments`} />
        <Stat label="Cancelled orders" value={snapshot.cancelledTotalMinor} detail={`${snapshot.cancelledCount} orders`} />
        <Stat label="Voided orders" value={snapshot.voidedTotalMinor} detail={`${snapshot.voidedCount} orders`} />
        <Stat label="Pending payments" value={snapshot.pendingPaymentTotalMinor} detail={`${snapshot.pendingPaymentCount} orders`} />
        <Stat label="Pending manual transfers" value={snapshot.pendingManualTransferMinor} detail={`${snapshot.pendingManualTransferCount} transfers`} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="secondary" onClick={download}>
          Download
        </Button>
        {isOwner && record.close.status === 'CLOSED' && (
          <Button variant="danger" onClick={onToggleReopen}>
            Reopen day
          </Button>
        )}
      </div>

      {isOwner && reopenOpen && record.close.status === 'CLOSED' && (
        <label className="mt-5 block max-w-xl text-sm font-black">
          Why are you reopening this day?
          <textarea
            required
            maxLength={500}
            value={reopenReason}
            onChange={(event) => onReopenReasonChange(event.target.value)}
            placeholder="Required, up to 500 characters"
            className="mt-2 min-h-24 w-full rounded-xl border border-line p-3 font-normal"
          />
        </label>
      )}
      {isOwner && reopenOpen && record.close.status === 'CLOSED' && (
        <Button
          className="mt-4"
          variant="danger"
          loading={busy}
          disabled={!online || !reopenReason.trim()}
          onClick={onReopen}
        >
          Reopen business day
        </Button>
      )}
      {!isOwner && (
        <p className="mt-5 rounded-xl bg-muted p-4 text-sm font-bold">
          Only the Owner can reopen the business day.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
  danger,
}: {
  label: string;
  value: number;
  detail?: string;
  danger?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <p className="text-sm font-bold text-ink-muted">{label}</p>
      <p className={`mt-3 text-xl font-black tabular-nums ${danger ? 'text-red-700' : ''}`}>{formatEtbMinor(value)}</p>
      {detail && <p className="mt-2 text-xs text-ink-muted">{detail}</p>}
    </section>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
      {children}
    </div>
  );
}

function State({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return (
    <section className="grid min-h-72 place-items-center text-center">
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{detail}</p>
        {retry && (
          <button onClick={retry} className="mt-4 min-h-11 rounded-xl bg-dark px-5 font-black text-white">
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
