'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatEtbMinor, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';

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
        <h2 className="text-lg font-black">Past shifts</h2>
        <p className="mt-2 text-sm text-ink-muted">Loading closed shift reports…</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-black">Past shifts</h2>
        <p className="mt-2 text-sm text-ink-muted">Could not load past shifts.</p>
        <button onClick={() => void query.refetch()} className="mt-4 min-h-11 rounded-xl bg-dark px-5 font-black text-white">
          Try again
        </button>
      </section>
    );
  }

  const reports = query.data ?? [];

  const formatClosedAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black">Past shifts</h2>
        <p className="text-xs text-ink-muted">Closed shift reports for this branch, newest first</p>
      </div>
      {reports.length === 0 ? (
        <p className="mt-3 rounded-xl bg-muted p-4 text-sm text-ink-muted">
          No closed shifts yet. Reports appear here after a shift is closed.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
                <th className="py-2 pr-4 font-bold">Business date</th>
                <th className="py-2 pr-4 font-bold">Closed at</th>
                <th className="py-2 pr-4 font-bold">Opening</th>
                <th className="py-2 pr-4 font-bold">Expected</th>
                <th className="py-2 pr-4 font-bold">Counted</th>
                <th className="py-2 pr-4 font-bold">Variance</th>
                <th className="py-2 pr-4 font-bold">Payments</th>
                <th className="py-2 font-bold">Orders</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-4 font-bold">{report.localBusinessDate.slice(0, 10)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-ink-muted">{formatClosedAt(report.localClosedAt)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(report.openingCashMinor)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(report.expectedCashMinor)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatEtbMinor(report.countedCashMinor)}</td>
                  <td className={`py-2 pr-4 tabular-nums font-bold ${report.varianceMinor !== '0' ? 'text-red-700' : ''}`}>
                    {formatEtbMinor(report.varianceMinor)}
                    {report.varianceReason && (
                      <span className="ml-2 text-xs font-normal text-ink-muted" title={report.varianceReason}>
                        reason given
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{report.paymentCount}</td>
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
