import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BusinessDayPreviewData {
  localBusinessDate: string;
  branchTimezone: string;
  businessDayCutoffLocal: string;
  utcStart: Date;
  utcEnd: Date;
  shiftReports: Array<{
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
  }>;
  openShifts: Array<{ id: string; cashierUserId: string; openedAt: Date }>;
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

export interface BusinessDayCloseSnapshot {
  localBusinessDate: string;
  branchTimezone: string;
  businessDayCutoffLocal: string;
  utcStart: string;
  utcEnd: string;
  closedAt: string;
  closedByUserId: string;
  closedWithException: boolean;
  reason: string | null;
  shiftReportIds: string[];
  shiftIds: string[];
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

@Injectable()
export class BusinessDayService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Compute UTC boundaries for a local business date using branch timezone and cutoff.
   * The business day runs from (localDate - 1 day at cutoff) to (localDate at cutoff) in UTC.
   * Uses Intl.DateTimeFormat for DST-safe conversion.
   */
  computeBusinessDayBoundaries(
    localBusinessDate: string,
    cutoffLocal: string,
    timezone: string,
  ): { utcStart: Date; utcEnd: Date } {
    const [cutoffHour, cutoffMinute] = cutoffLocal.split(':').map(Number);

    // utcEnd = localBusinessDate at cutoffLocal, converted to UTC
    const utcEnd = this.localToUtc(localBusinessDate, cutoffHour, cutoffMinute, timezone);

    // utcStart = (localBusinessDate - 1 day) at cutoffLocal, converted to UTC
    const prevDate = new Date(localBusinessDate + 'T00:00:00');
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    const utcStart = this.localToUtc(prevDateStr, cutoffHour, cutoffMinute, timezone);

    return { utcStart, utcEnd };
  }

  /**
   * Determine which local business date a given UTC instant belongs to,
   * given a branch timezone and cutoff.
   */
  utcToLocalBusinessDate(utcNow: Date, cutoffLocal: string, timezone: string): string {
    const [cutoffHour, cutoffMinute] = cutoffLocal.split(':').map(Number);

    // Convert utcNow to local time
    const localParts = this.utcToLocalParts(utcNow, timezone);
    const localHour = localParts.hour;
    const localMinute = localParts.minute;

    // If local time is before cutoff, this instant belongs to the previous business day
    const localDateStr = `${localParts.year}-${String(localParts.month).padStart(2, '0')}-${String(localParts.day).padStart(2, '0')}`;
    const isBeforeCutoff = localHour < cutoffHour || (localHour === cutoffHour && localMinute < cutoffMinute);

    if (isBeforeCutoff) {
      const prevDate = new Date(localDateStr + 'T00:00:00');
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      return prevDate.toISOString().split('T')[0];
    }

    return localDateStr;
  }

  /**
   * Convert a local date + hour:minute to UTC Date using timezone.
   */
  private localToUtc(dateStr: string, hour: number, minute: number, timezone: string): Date {
    // Build an ISO string with the local time, then use Intl to find the offset
    const localIso = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

    // Use a formatter to get the UTC equivalent
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    // Parse what the timezone thinks this time is
    const parts = formatter.formatToParts(new Date(localIso + 'Z'));
    const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);

    // The formatter gives us the wall-clock representation in the target timezone.
    // We need to find the UTC time that corresponds to this wall clock.
    // Strategy: create a date in the target timezone, then find its UTC equivalent.
    const tzDate = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

    // Get the offset by comparing formatted local time with UTC
    const utcParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(tzDate);

    const utcGet = (type: string) => parseInt(utcParts.find(p => p.type === type)!.value, 10);

    // Local representation minus UTC representation = offset in hours
    const localAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const utcMs = Date.UTC(utcGet('year'), utcGet('month') - 1, utcGet('day'), utcGet('hour'), utcGet('minute'), utcGet('second'));
    const offsetMs = localAsUTC - utcMs;

    // UTC time = local wall clock - offset
    return new Date(localAsUTC - offsetMs);
  }

  /**
   * Get local time parts from a UTC date in a given timezone.
   */
  private utcToLocalParts(utcDate: Date, timezone: string): {
    year: number; month: number; day: number; hour: number; minute: number; second: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(utcDate);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
    return {
      year: get('year'), month: get('month'), day: get('day'),
      hour: get('hour'), minute: get('minute'), second: get('second'),
    };
  }

  /**
   * Preview the business day: compute all reconciliation data and blockers.
   */
  async preview(params: {
    tenantId: string;
    branchId: string;
    localBusinessDate?: string;
  }): Promise<BusinessDayPreviewData> {
    const { tenantId, branchId, localBusinessDate: requestedDate } = params;

    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.tenantId !== tenantId) {
      throw new NotFoundException('Branch not found');
    }

    const timezone = branch.timezone;
    const cutoff = branch.businessDayCutoffLocal;
    const now = new Date();
    const localBusinessDate = requestedDate || this.utcToLocalBusinessDate(now, cutoff, timezone);

    const { utcStart, utcEnd } = this.computeBusinessDayBoundaries(localBusinessDate, cutoff, timezone);

    // Check if already closed
    const existingClose = await this.prisma.businessDayClose.findUnique({
      where: { tenantId_branchId_localBusinessDate: { tenantId, branchId, localBusinessDate: new Date(localBusinessDate) } },
    });
    const alreadyClosed = existingClose?.status === 'CLOSED';

    // Get shift reports for this business day
    const shiftReports = await this.prisma.shiftReportSnapshot.findMany({
      where: {
        tenantId, branchId,
        localBusinessDate: new Date(localBusinessDate),
      },
    });

    // Get open shifts
    const openShifts = await this.prisma.cashShift.findMany({
      where: { tenantId, branchId, status: 'OPEN' },
      select: { id: true, cashierUserId: true, openedAt: true },
    });

    // Payment totals by method
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId, branchId,
        createdAt: { gte: utcStart, lt: utcEnd },
      },
      select: { method: true, status: true, amountMinor: true },
    });

    const cashApproved = payments.filter(p => p.method === 'CASH' && p.status === 'APPROVED');
    const cashPending = payments.filter(p => p.method === 'CASH' && (p.status === 'PENDING' || p.status === 'PENDING_VERIFICATION'));
    const bankApproved = payments.filter(p => p.method === 'BANK_TRANSFER' && p.status === 'APPROVED');
    const bankPending = payments.filter(p => p.method === 'BANK_TRANSFER' && (p.status === 'PENDING' || p.status === 'PENDING_VERIFICATION'));
    const telebirrApproved = payments.filter(p => p.method === 'TELEBIRR' && p.status === 'APPROVED');
    const telebirrPending = payments.filter(p => p.method === 'TELEBIRR' && (p.status === 'PENDING' || p.status === 'PENDING_VERIFICATION'));
    const manualPending = payments.filter(p => p.method === 'MANUAL_TRANSFER' && p.status === 'PENDING_VERIFICATION');

    // Order totals
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId, branchId,
        createdAt: { gte: utcStart, lt: utcEnd },
      },
      select: { status: true, totalMinor: true },
    });

    const confirmedOrders = orders.filter(o => o.status === 'CONFIRMED' || o.status === 'IN_PROGRESS' || o.status === 'READY' || o.status === 'COMPLETED');
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED');
    const voidedOrders = orders.filter(o => o.status === 'VOIDED');
    const pendingPaymentOrders = orders.filter(o => o.status === 'PENDING_PAYMENT');

    // Compute blockers
    const blockers: string[] = [];
    if (alreadyClosed) {
      blockers.push('Business day is already closed');
    }
    if (openShifts.length > 0) {
      blockers.push(`${openShifts.length} open cashier shift(s) must be closed first`);
    }
    if (manualPending.length > 0) {
      blockers.push(`${manualPending.length} manual transfer(s) pending verification`);
    }
    if (cashPending.length > 0) {
      blockers.push(`${cashPending.length} cash payment(s) pending`);
    }
    if (bankPending.length > 0) {
      blockers.push(`${bankPending.length} bank transfer payment(s) pending`);
    }
    if (telebirrPending.length > 0) {
      blockers.push(`${telebirrPending.length} Telebirr payment(s) pending`);
    }

    const status = alreadyClosed ? 'ALREADY_CLOSED' : blockers.length > 0 ? 'BLOCKED' : 'READY';

    return {
      localBusinessDate,
      branchTimezone: timezone,
      businessDayCutoffLocal: cutoff,
      utcStart,
      utcEnd,
      shiftReports: shiftReports.map(r => ({
        cashShiftId: r.cashShiftId,
        cashierUserId: r.openedByUserId,
        openingCashMinor: Number(r.openingCashMinor),
        approvedCashMinor: Number(r.approvedCashMinor),
        expectedCashMinor: Number(r.expectedCashMinor),
        countedCashMinor: Number(r.countedCashMinor),
        varianceMinor: Number(r.varianceMinor),
        paymentCount: r.paymentCount,
        orderCount: r.orderCount,
        cancellationCount: r.cancellationCount,
        voidCount: r.voidCount,
      })),
      openShifts,
      paymentTotals: {
        cash: {
          approvedMinor: cashApproved.reduce((s, p) => s + Number(p.amountMinor), 0),
          pendingMinor: cashPending.reduce((s, p) => s + Number(p.amountMinor), 0),
          count: cashApproved.length + cashPending.length,
        },
        bankTransfer: {
          approvedMinor: bankApproved.reduce((s, p) => s + Number(p.amountMinor), 0),
          pendingMinor: bankPending.reduce((s, p) => s + Number(p.amountMinor), 0),
          count: bankApproved.length + bankPending.length,
        },
        telebirr: {
          approvedMinor: telebirrApproved.reduce((s, p) => s + Number(p.amountMinor), 0),
          pendingMinor: telebirrPending.reduce((s, p) => s + Number(p.amountMinor), 0),
          count: telebirrApproved.length + telebirrPending.length,
        },
        manualTransfer: {
          pendingVerificationMinor: manualPending.reduce((s, p) => s + Number(p.amountMinor), 0),
          count: manualPending.length,
        },
      },
      orderTotals: {
        confirmed: {
          count: confirmedOrders.length,
          totalMinor: confirmedOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        },
        cancelled: {
          count: cancelledOrders.length,
          totalMinor: cancelledOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        },
        voided: {
          count: voidedOrders.length,
          totalMinor: voidedOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        },
        pendingPayment: {
          count: pendingPaymentOrders.length,
          totalMinor: pendingPaymentOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        },
      },
      blockers,
      status,
    };
  }

  /**
   * Close a business day. Normal close is blocked by open shifts and pending payments.
   * Owner can force close with exception and mandatory reason.
   */
  async close(params: {
    tenantId: string;
    branchId: string;
    localBusinessDate: string;
    closedWithException?: boolean;
    reason?: string;
    actorUserId: string;
  }): Promise<{ close: BusinessDayCloseSnapshot; id: string }> {
    const { tenantId, branchId, localBusinessDate, closedWithException = false, reason, actorUserId } = params;

    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.tenantId !== tenantId) {
      throw new NotFoundException('Branch not found');
    }

    // Validate exception close requires reason
    if (closedWithException) {
      if (!reason || reason.trim().length === 0) {
        throw new BadRequestException('Reason is required for close with exception');
      }
      if (reason.length > 500) {
        throw new BadRequestException('Reason must be 500 characters or less');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the business day close row if it exists
      const existing = await tx.$queryRaw<
        Array<{ id: string; status: string; version: number }>
      >`
        SELECT id, status, version
        FROM "BusinessDayClose"
        WHERE "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
          AND "localBusinessDate" = ${new Date(localBusinessDate)}
        FOR UPDATE
      `;

      if (existing.length > 0 && existing[0].status === 'CLOSED') {
        throw new ConflictException('Business day is already closed');
      }

      // Re-check blockers inside transaction
      const openShifts = await tx.cashShift.count({
        where: { tenantId, branchId, status: 'OPEN' },
      });

      if (openShifts > 0 && !closedWithException) {
        throw new ConflictException(`${openShifts} open cashier shift(s) must be closed first`);
      }

      const manualPending = await tx.payment.count({
        where: {
          tenantId, branchId,
          method: 'MANUAL_TRANSFER',
          status: 'PENDING_VERIFICATION',
        },
      });

      if (manualPending > 0 && !closedWithException) {
        throw new ConflictException(`${manualPending} manual transfer(s) pending verification`);
      }

      const pendingCash = await tx.payment.count({
        where: { tenantId, branchId, method: 'CASH', status: 'PENDING' },
      });
      const pendingBank = await tx.payment.count({
        where: { tenantId, branchId, method: 'BANK_TRANSFER', status: 'PENDING' },
      });
      const pendingTelebirr = await tx.payment.count({
        where: { tenantId, branchId, method: 'TELEBIRR', status: 'PENDING' },
      });

      if ((pendingCash + pendingBank + pendingTelebirr) > 0 && !closedWithException) {
        throw new ConflictException('Pending payments must be resolved before closing');
      }

      // Compute preview data for the snapshot
      const timezone = branch.timezone;
      const cutoff = branch.businessDayCutoffLocal;
      const { utcStart, utcEnd } = this.computeBusinessDayBoundaries(localBusinessDate, cutoff, timezone);

      // Gather snapshot data
      const shiftReports = await tx.shiftReportSnapshot.findMany({
        where: { tenantId, branchId, localBusinessDate: new Date(localBusinessDate) },
      });

      const payments = await tx.payment.findMany({
        where: { tenantId, branchId, createdAt: { gte: utcStart, lt: utcEnd } },
        select: { method: true, status: true, amountMinor: true },
      });

      const orders = await tx.order.findMany({
        where: { tenantId, branchId, createdAt: { gte: utcStart, lt: utcEnd } },
        select: { status: true, totalMinor: true },
      });

      // Compute totals
      const bankApproved = payments.filter(p => p.method === 'BANK_TRANSFER' && p.status === 'APPROVED');
      const telebirrApproved = payments.filter(p => p.method === 'TELEBIRR' && p.status === 'APPROVED');
      const manualPendingPayments = payments.filter(p => p.method === 'MANUAL_TRANSFER' && p.status === 'PENDING_VERIFICATION');
      const pendingPayments = payments.filter(p => (p.method === 'CASH' || p.method === 'BANK_TRANSFER' || p.method === 'TELEBIRR') && p.status === 'PENDING');

      const confirmedOrders = orders.filter(o => ['CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED'].includes(o.status));
      const cancelledOrders = orders.filter(o => o.status === 'CANCELLED');
      const voidedOrders = orders.filter(o => o.status === 'VOIDED');

      // Cash variance from shift reports
      const totalExpectedCash = shiftReports.reduce((s, r) => s + Number(r.expectedCashMinor), 0);
      const totalCountedCash = shiftReports.reduce((s, r) => s + Number(r.countedCashMinor), 0);

      const snapshot: BusinessDayCloseSnapshot = {
        localBusinessDate,
        branchTimezone: timezone,
        businessDayCutoffLocal: cutoff,
        utcStart: utcStart.toISOString(),
        utcEnd: utcEnd.toISOString(),
        closedAt: new Date().toISOString(),
        closedByUserId: actorUserId,
        closedWithException,
        reason: reason ?? null,
        shiftReportIds: shiftReports.map(r => r.id),
        shiftIds: shiftReports.map(r => r.cashShiftId),
        expectedCashMinor: totalExpectedCash,
        countedCashMinor: totalCountedCash,
        cashVarianceMinor: totalCountedCash - totalExpectedCash,
        bankTransferTotalMinor: bankApproved.reduce((s, p) => s + Number(p.amountMinor), 0),
        bankTransferCount: bankApproved.length,
        telebirrTotalMinor: telebirrApproved.reduce((s, p) => s + Number(p.amountMinor), 0),
        telebirrCount: telebirrApproved.length,
        recognizedSalesMinor: confirmedOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        recognizedSalesCount: confirmedOrders.length,
        cancelledTotalMinor: cancelledOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        cancelledCount: cancelledOrders.length,
        voidedTotalMinor: voidedOrders.reduce((s, o) => s + Number(o.totalMinor), 0),
        voidedCount: voidedOrders.length,
        pendingPaymentTotalMinor: pendingPayments.reduce((s, p) => s + Number(p.amountMinor), 0),
        pendingPaymentCount: pendingPayments.length,
        pendingManualTransferMinor: manualPendingPayments.reduce((s, p) => s + Number(p.amountMinor), 0),
        pendingManualTransferCount: manualPendingPayments.length,
        inventoryExceptions: [],
      };

      let closeId: string;

      if (existing.length > 0) {
        // Reopen cycle: update existing record
        const old = existing[0];
        await tx.businessDayClose.update({
          where: { id: old.id },
          data: {
            status: 'CLOSED',
            snapshotJson: snapshot as any,
            closedWithException,
            reason: reason ?? null,
            closedByUserId: actorUserId,
            closedAt: new Date(),
            reopenedByUserId: null,
            reopenedAt: null,
            reopenReason: null,
            version: { increment: 1 },
          },
        });
        closeId = old.id;
      } else {
        // First close
        const created = await tx.businessDayClose.create({
          data: {
            tenantId,
            branchId,
            localBusinessDate: new Date(localBusinessDate),
            status: 'CLOSED',
            snapshotJson: snapshot as any,
            closedWithException,
            reason: reason ?? null,
            closedByUserId: actorUserId,
          },
        });
        closeId = created.id;
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: closedWithException ? 'BUSINESS_DAY_CLOSE_EXCEPTION' : 'BUSINESS_DAY_CLOSE',
          entityType: 'BusinessDayClose',
          entityId: closeId,
          afterJson: {
            localBusinessDate,
            status: 'CLOSED',
            closedWithException,
            shiftCount: shiftReports.length,
            recognizedSalesMinor: snapshot.recognizedSalesMinor,
          },
        },
      });

      return { snapshot, id: closeId };
    });

    return { close: result.snapshot, id: result.id };
  }

  /**
   * Reopen a closed business day. Owner only, requires reason.
   * Original snapshot is preserved; a new audit entry records the reopen.
   */
  async reopen(params: {
    tenantId: string;
    branchId: string;
    localBusinessDate: string;
    reason: string;
    actorUserId: string;
  }): Promise<{ id: string; previousSnapshot: BusinessDayCloseSnapshot }> {
    const { tenantId, branchId, localBusinessDate, reason, actorUserId } = params;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reason is required to reopen a business day');
    }
    if (reason.length > 500) {
      throw new BadRequestException('Reason must be 500 characters or less');
    }

    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.tenantId !== tenantId) {
      throw new NotFoundException('Branch not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; version: number; snapshotJson: any }>
      >`
        SELECT id, status, version, "snapshotJson"
        FROM "BusinessDayClose"
        WHERE "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
          AND "localBusinessDate" = ${new Date(localBusinessDate)}
        FOR UPDATE
      `;

      if (rows.length === 0) {
        throw new NotFoundException('No close record found for this business day');
      }

      const row = rows[0];
      if (row.status === 'REOPENED') {
        throw new ConflictException('Business day is already reopened');
      }

      const previousSnapshot = row.snapshotJson as BusinessDayCloseSnapshot;

      await tx.businessDayClose.update({
        where: { id: row.id },
        data: {
          status: 'REOPENED',
          reopenedByUserId: actorUserId,
          reopenedAt: new Date(),
          reopenReason: reason,
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'BUSINESS_DAY_REOPEN',
          entityType: 'BusinessDayClose',
          entityId: row.id,
          beforeJson: { status: 'CLOSED', version: row.version },
          afterJson: { status: 'REOPENED', reopenReason: reason },
        },
      });

      return { id: row.id, previousSnapshot };
    });

    return { id: result.id, previousSnapshot: result.previousSnapshot };
  }

  /**
   * Get the current close record for a business day.
   */
  async getClose(params: {
    tenantId: string;
    branchId: string;
    localBusinessDate: string;
  }): Promise<{ close: any; snapshot: BusinessDayCloseSnapshot | null } | null> {
    const { tenantId, branchId, localBusinessDate } = params;

    const close = await this.prisma.businessDayClose.findUnique({
      where: { tenantId_branchId_localBusinessDate: { tenantId, branchId, localBusinessDate: new Date(localBusinessDate) } },
    });

    if (!close) return null;

    return {
      close: {
        id: close.id,
        status: close.status,
        closedWithException: close.closedWithException,
        reason: close.reason,
        closedByUserId: close.closedByUserId,
        closedAt: close.closedAt,
        reopenedByUserId: close.reopenedByUserId,
        reopenedAt: close.reopenedAt,
        reopenReason: close.reopenReason,
        version: close.version,
      },
      snapshot: close.snapshotJson as unknown as BusinessDayCloseSnapshot,
    };
  }

  /**
   * Get printable report data for a closed business day.
   */
  async getReport(params: {
    tenantId: string;
    branchId: string;
    localBusinessDate: string;
  }): Promise<BusinessDayCloseSnapshot | null> {
    const result = await this.getClose(params);
    return result?.snapshot ?? null;
  }
}
