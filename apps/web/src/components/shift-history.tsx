'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { useLocale } from '@/components/locale-provider';

interface ShiftReport {
  id: string;
  cashShiftId: string;
  openingCashMinor: string;
  approvedCashMinor: string;
  expectedCashMinor: string;
  countedCashMinor: string;
  varianceMinor: string;
  varianceReason: string | null;
  orderCount: number;
  paymentCount: number;
  localOpenedAt: string;
  localClosedAt: string;
  localBusinessDate: string;
}

export function ShiftHistory() {
  const { accessToken, profile } = useAuth();
  const { formatCurrency, tr, formatDate } = useLocale();
  const { branchId } = useBranch();
  const membership = profile?.memberships?.[0];
  const tenantId = membership?.tenant.id ?? '';
  const role = membership?.role ?? '';
  const allowed = role === 'OWNER' || role === 'MANAGER';

  const query = useQuery({
    queryKey: ['shift-reports', tenantId, branchId],
    enabled: Boolean(accessToken && tenantId && branchId && allowed),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<ShiftReport[]>>(`/branches/${branchId}/shifts/reports`, {
        accessToken,
        tenantId,
      })).data,
  });

  if (!allowed) return null;
  if (query.isLoading) {
    return (
      <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-black">{tr('shifts.pastShifts')}</h2>
        <p className="mt-2 text-sm text-ink-muted">{tr('shifts.loadingReports')}</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-black">{tr('shifts.pastShifts')}</h2>
        <p className="mt-2 text-sm text-ink-muted">{tr('shifts.loadReportsError')}</p>
        <button onClick={() => void query.refetch()} className="mt-4 min-h-11 rounded-xl bg-dark px-5 font-black text-white">
          {tr('common.tryAgain')}
        </button>
      </section>
    );
  }

  const reports = query.data ?? [];

  const formatClosedAt = (iso: string) => {
    try {
      return formatDate(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return iso;
    }
  };

  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black">{tr('shifts.pastShifts')}</h2>
        <p className="text-xs text-ink-muted">{tr('shifts.historySub')}</p>
      </div>
      {reports.length === 0 ? (
        <p className="mt-3 rounded-xl bg-muted p-4 text-sm text-ink-muted">
          {tr('shifts.noClosedShifts')}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs uppercase text-ink-muted">
                <th className="py-2 pe-4 font-bold">{tr('shifts.thBusinessDate')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thClosedAt')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thOpening')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thExpected')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thCounted')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thVariance')}</th>
                <th className="py-2 pe-4 font-bold">{tr('shifts.thPayments')}</th>
                <th className="py-2 font-bold">{tr('shifts.thOrders')}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pe-4 font-bold">{report.localBusinessDate.slice(0, 10)}</td>
                  <td className="py-2 pe-4 whitespace-nowrap text-ink-muted">{formatClosedAt(report.localClosedAt)}</td>
                  <td className="py-2 pe-4 tabular-nums">{formatCurrency(report.openingCashMinor)}</td>
                  <td className="py-2 pe-4 tabular-nums">{formatCurrency(report.expectedCashMinor)}</td>
                  <td className="py-2 pe-4 tabular-nums">{formatCurrency(report.countedCashMinor)}</td>
                  <td className={`py-2 pe-4 tabular-nums font-bold ${report.varianceMinor !== '0' ? 'text-red-700' : ''}`}>
                    {formatCurrency(report.varianceMinor)}
                    {report.varianceReason && (
                      <span className="ms-2 text-xs font-normal text-ink-muted" title={report.varianceReason}>
                        {tr('shifts.reasonGiven')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pe-4 tabular-nums">{report.paymentCount}</td>
                  <td className="py-2 tabular-nums">{report.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
