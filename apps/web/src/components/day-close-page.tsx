'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useLocale } from '@/components/locale-provider';
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
  const { formatCurrency, tr } = useLocale();
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
    if (withException && !effectiveReason) return setMessage(tr('shifts.needExceptionReason'));
    if (!online) return setMessage(tr('shifts.offlineDayClose'));
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
      setMessage(error instanceof ApiError ? error.message : tr('shifts.dayCloseError'));
      await previewQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function reopenDay() {
    const effectiveReason = reopenReason.trim();
    if (!effectiveReason) return setMessage(tr('shifts.reopenReasonRequired'));
    if (!online) return setMessage(tr('shifts.offlineReopen'));
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
      setMessage(error instanceof ApiError ? error.message : tr('shifts.dayReopenError'));
      await currentQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (!membership || !allowed) {
    return <State title={tr('shifts.permissionTitle')} detail={tr('shifts.dayPermissionDetail')} />;
  }
  if (previewQuery.isLoading || currentQuery.isLoading) {
    return <State title={tr('shifts.loadingDayTitle')} detail={tr('shifts.loadingDayDetail')} />;
  }
  if (previewQuery.isError || currentQuery.isError) {
    return (
      <State
        title={tr('shifts.dayUnavailableTitle')}
        detail={tr('shifts.reconnectDetail')}
        retry={() => {
          void previewQuery.refetch();
          void currentQuery.refetch();
        }}
      />
    );
  }
  if (!preview) return <State title={tr('shifts.dayUnavailableTitle')} detail={tr('shifts.noDataDetail')} />;

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
          {tr('shifts.reopenedBanner', { suffix: reopened.reopenReason ? `: ${reopened.reopenReason}` : '.' })}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
          {preview.status === 'BLOCKED' ? (
            <StatusChip status="danger">{tr('status.dayBlocked')}</StatusChip>
          ) : preview.status === 'ALREADY_CLOSED' ? (
            <StatusChip status="info">{tr('status.dayAlreadyClosed')}</StatusChip>
          ) : (
            <StatusChip status="success">{tr('status.dayReadyToClose')}</StatusChip>
        )}
        <span className="text-sm text-ink-muted">
          {tr('shifts.tzStartsAt', { tz: preview.branchTimezone, cutoff: preview.businessDayCutoffLocal })}
        </span>
      </div>

      {preview.blockers.length > 0 && (
        <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-black text-red-800">{tr('shifts.blockersTitle')}</h2>
          <ul className="mt-2 list-disc ps-5 text-sm font-semibold text-red-800">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={tr('shifts.recognisedSales')} value={preview.orderTotals.confirmed.totalMinor} detail={tr('shifts.ordersCount', { count: preview.orderTotals.confirmed.count })} />
        <Stat label={tr('shifts.cashApproved')} value={preview.paymentTotals.cash.approvedMinor} detail={tr('shifts.paymentsCount', { count: preview.paymentTotals.cash.count })} />
        <Stat label={tr('shifts.bankApproved')} value={preview.paymentTotals.bankTransfer.approvedMinor} detail={tr('shifts.paymentsCount', { count: preview.paymentTotals.bankTransfer.count })} />
        <Stat label={tr('shifts.telebirrApproved')} value={preview.paymentTotals.telebirr.approvedMinor} detail={tr('shifts.paymentsCount', { count: preview.paymentTotals.telebirr.count })} />
        <Stat label={tr('shifts.cancelledOrders')} value={preview.orderTotals.cancelled.totalMinor} detail={tr('shifts.ordersCount', { count: preview.orderTotals.cancelled.count })} />
        <Stat label={tr('shifts.voidedOrders')} value={preview.orderTotals.voided.totalMinor} detail={tr('shifts.ordersCount', { count: preview.orderTotals.voided.count })} />
        <Stat
          label={tr('shifts.pendingPayments')}
          value={preview.orderTotals.pendingPayment.totalMinor}
          detail={tr('shifts.awaitingPaymentCount', { count: preview.orderTotals.pendingPayment.count })}
        />
        <Stat
          label={tr('shifts.manualToVerify')}
          value={preview.paymentTotals.manualTransfer.pendingVerificationMinor}
          detail={tr('shifts.transfersCount', { count: preview.paymentTotals.manualTransfer.count })}
        />
      </div>

      {preview.shiftReports.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-card">
          <h2 className="text-lg font-black">{tr('shifts.closedShiftsTitle')}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs uppercase text-ink-muted">
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thShift')}</th>
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thOpening')}</th>
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thExpected')}</th>
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thCounted')}</th>
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thVariance')}</th>
                  <th className="py-2 pe-4 font-bold">{tr('shifts.thPayments')}</th>
                  <th className="py-2 font-bold">{tr('shifts.thOrders')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.shiftReports.map((row, index) => (
                  <tr key={row.cashShiftId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pe-4 font-bold">{tr('shifts.shiftNumber', { n: index + 1 })}</td>
                    <td className="py-2 pe-4 tabular-nums">{formatCurrency(row.openingCashMinor)}</td>
                    <td className="py-2 pe-4 tabular-nums">{formatCurrency(row.expectedCashMinor)}</td>
                    <td className="py-2 pe-4 tabular-nums">{formatCurrency(row.countedCashMinor)}</td>
                    <td className={`py-2 pe-4 tabular-nums font-bold ${row.varianceMinor !== 0 ? 'text-red-700' : ''}`}>
                      {formatCurrency(row.varianceMinor)}
                    </td>
                    <td className="py-2 pe-4 tabular-nums">{row.paymentCount}</td>
                    <td className="py-2 tabular-nums">{row.orderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-6 max-w-2xl rounded-2xl border border-line bg-white p-6 shadow-card">
        <h2 className="text-xl font-black">{tr('shifts.closeTitle')}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {tr('shifts.closeHintDay')}
        </p>

        {!isOwner ? (
          <p className="mt-4 rounded-xl bg-muted p-4 text-sm font-bold">
            {tr('shifts.ownerOnlyClose')}
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
                <span>{tr('shifts.exceptionCheck')}</span>
              </label>
            )}
            {exception && (
              <label className="mt-4 block text-sm font-black">
                {tr('shifts.closeReasonLabel')}
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={tr('shifts.required500')}
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
                {tr(exception ? 'shifts.closeWithException' : 'shifts.closeBusinessDay')}
              </Button>
            )}
            {preview.status === 'BLOCKED' && !exception && (
              <p className="mt-4 text-sm text-ink-muted">
                {tr('shifts.resolveHint')}
              </p>
            )}
            {!online && (
              <p className="mt-4 text-sm font-bold text-red-700">{tr('shifts.offlineClosing')}</p>
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
  const { tr } = useLocale();
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-brand">{tr('shifts.dayEyebrow')}</p>
        <h1 className="mt-2 text-3xl font-black">{tr('shifts.dayPageTitle')}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {tr('shifts.dayPageDescription')}
        </p>
      </div>
      <label className="text-sm font-black">
        {tr('shifts.businessDate')}
        <input
          type="date"
          value={dateValue}
          onChange={(event) => onDateChange(event.target.value)}
          className="mt-2 block min-h-11 rounded-xl border border-line bg-white px-4 font-normal"
        />
        <span className="mt-1 block text-xs font-normal text-ink-muted">
          {tr('shifts.cutoffInfo', { tz: preview.branchTimezone, cutoff: preview.businessDayCutoffLocal })}
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
  const { tr } = useLocale();
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
        <p className="text-xs font-black uppercase tracking-wider text-emerald-700">{tr('shifts.dayClosedEyebrow')}</p>
        <StatusChip status="success">{tr('status.dayClosed')}</StatusChip>
        {snapshot.closedWithException && <StatusChip status="warning">{tr('status.dayClosedWithException')}</StatusChip>}
        {record.close.status === 'REOPENED' && <StatusChip status="info">{tr('status.dayReopened')}</StatusChip>}
      </div>
      <h1 className="mt-2 text-3xl font-black">{snapshot.localBusinessDate}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {tr('shifts.closedAtLine', { date: formatInTz(snapshot.closedAt, tz), tz })}
      </p>
      {snapshot.closedWithException && snapshot.reason && (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <b>{tr('shifts.exceptionReasonLabel')}</b> {snapshot.reason}
        </p>
      )}
      {record.close.status === 'REOPENED' && record.close.reopenReason && (
        <p className="mt-4 rounded-xl bg-muted p-4 text-sm">
          <b>{tr('shifts.reopenedLabel')}</b> {record.close.reopenReason}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={tr('shifts.recognisedSales')} value={snapshot.recognizedSalesMinor} detail={tr('shifts.ordersCount', { count: snapshot.recognizedSalesCount })} />
        <Stat label={tr('shifts.expectedCash')} value={snapshot.expectedCashMinor} />
        <Stat label={tr('shifts.countedCash')} value={snapshot.countedCashMinor} />
        <Stat label={tr('shifts.cashVariance')} value={snapshot.cashVarianceMinor} danger={snapshot.cashVarianceMinor !== 0} />
        <Stat label={tr('shifts.bankTransfers')} value={snapshot.bankTransferTotalMinor} detail={tr('shifts.paymentsCount', { count: snapshot.bankTransferCount })} />
        <Stat label={tr('shifts.telebirrLabel')} value={snapshot.telebirrTotalMinor} detail={tr('shifts.paymentsCount', { count: snapshot.telebirrCount })} />
        <Stat label={tr('shifts.cancelledOrders')} value={snapshot.cancelledTotalMinor} detail={tr('shifts.ordersCount', { count: snapshot.cancelledCount })} />
        <Stat label={tr('shifts.voidedOrders')} value={snapshot.voidedTotalMinor} detail={tr('shifts.ordersCount', { count: snapshot.voidedCount })} />
        <Stat label={tr('shifts.pendingPayments')} value={snapshot.pendingPaymentTotalMinor} detail={tr('shifts.ordersCount', { count: snapshot.pendingPaymentCount })} />
        <Stat label={tr('shifts.pendingManual')} value={snapshot.pendingManualTransferMinor} detail={tr('shifts.transfersCount', { count: snapshot.pendingManualTransferCount })} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => window.print()}>
          {tr('shifts.print')}
        </Button>
        <Button variant="secondary" onClick={download}>
          {tr('shifts.download')}
        </Button>
        {isOwner && record.close.status === 'CLOSED' && (
          <Button variant="danger" onClick={onToggleReopen}>
            {tr('shifts.reopenDayBtn')}
          </Button>
        )}
      </div>

      {isOwner && reopenOpen && record.close.status === 'CLOSED' && (
        <label className="mt-5 block max-w-xl text-sm font-black">
          {tr('shifts.reopenLabel')}
          <textarea
            required
            maxLength={500}
            value={reopenReason}
            onChange={(event) => onReopenReasonChange(event.target.value)}
            placeholder={tr('shifts.required500')}
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
          {tr('shifts.reopenBusinessDay')}
        </Button>
      )}
      {!isOwner && (
        <p className="mt-5 rounded-xl bg-muted p-4 text-sm font-bold">
          {tr('shifts.ownerOnlyReopen')}
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
  const { formatCurrency } = useLocale();
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <p className="text-sm font-bold text-ink-muted">{label}</p>
      <p className={`mt-3 text-xl font-black tabular-nums ${danger ? 'text-red-700' : ''}`}>{formatCurrency(value)}</p>
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
  const { tr } = useLocale();
  return (
    <section className="grid min-h-72 place-items-center text-center">
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
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
