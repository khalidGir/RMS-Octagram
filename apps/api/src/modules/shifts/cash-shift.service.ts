import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PrismaClient } from '@prisma/client';

export type PrismaTransactionClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface CashShiftSummary {
  id: string;
  tenantId: string;
  branchId: string;
  cashierUserId: string;
  status: string;
  openingCashMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  varianceReason: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftReportSnapshotData {
  id: string;
  tenantId: string;
  branchId: string;
  cashShiftId: string;
  openingCashMinor: number;
  approvedCashMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  varianceMinor: number;
  varianceReason: string | null;
  orderCount: number;
  paymentCount: number;
  cancellationCount: number;
  voidCount: number;
  localOpenedAt: Date;
  localClosedAt: Date;
  localBusinessDate: Date;
  openedByUserId: string;
  closedByUserId: string;
  createdAt: Date;
}

@Injectable()
export class CashShiftService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Open a new cash shift for a cashier at a branch.
   * Only one OPEN shift per (tenant, branch, cashier) enforced by partial unique index.
   * Handles concurrent open attempts via conflict catch + retry.
   */
  async openShift(params: {
    tenantId: string;
    branchId: string;
    cashierUserId: string;
    openingCashMinor: number;
    actorUserId: string;
  }): Promise<CashShiftSummary> {
    const { tenantId, branchId, cashierUserId, openingCashMinor, actorUserId } = params;

    if (openingCashMinor < 0) {
      throw new BadRequestException('Opening cash cannot be negative');
    }

    // Check for existing OPEN shift
    const existing = await this.prisma.cashShift.findFirst({
      where: { tenantId, branchId, cashierUserId, status: 'OPEN' },
    });

    if (existing) {
      throw new ConflictException('Cashier already has an active shift. Close it before opening a new one.');
    }

    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        const newShift = await tx.cashShift.create({
          data: {
            tenantId,
            branchId,
            cashierUserId,
            status: 'OPEN',
            openingCashMinor: BigInt(openingCashMinor),
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            tenantId,
            branchId,
            action: 'CASH_SHIFT_OPEN',
            entityType: 'CashShift',
            entityId: newShift.id,
            afterJson: {
              cashierUserId,
              openingCashMinor,
              status: 'OPEN',
            },
          },
        });

        return newShift;
      });

      return this.serializeShift(shift);
    } catch (error: any) {
      // P2002 = unique constraint violation on partial unique index (concurrent open)
      if (error?.code === 'P2002') {
        throw new ConflictException('Cashier already has an active shift (concurrent open detected)');
      }
      throw error;
    }
  }

  /**
   * Get the current active (OPEN) shift for a cashier at a branch.
   */
  async getCurrentShift(params: {
    tenantId: string;
    branchId: string;
    cashierUserId: string;
  }): Promise<CashShiftSummary | null> {
    const { tenantId, branchId, cashierUserId } = params;

    const shift = await this.prisma.cashShift.findFirst({
      where: { tenantId, branchId, cashierUserId, status: 'OPEN' },
    });

    return shift ? this.serializeShift(shift) : null;
  }

  /**
   * Close a cash shift. Uses optimistic locking via version field.
   * Computes expectedCashMinor from confirmed CASH payments during the shift.
   * Variance = countedCashMinor - expectedCashMinor.
   * Non-zero variance requires a bounded reason.
   * Creates an immutable ShiftReportSnapshot.
   */
  async closeShift(params: {
    tenantId: string;
    branchId: string;
    shiftId: string;
    countedCashMinor: number;
    varianceReason?: string;
    expectedVersion: number;
    actorUserId: string;
  }): Promise<{ shift: CashShiftSummary; report: ShiftReportSnapshotData }> {
    const { tenantId, branchId, shiftId, countedCashMinor, varianceReason, expectedVersion, actorUserId } = params;

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the shift for update
      const shifts = await tx.$queryRaw<
        Array<{ id: string; version: number; status: string; openingCashMinor: bigint; cashierUserId: string; openedAt: Date }>
      >`
        SELECT id, version, status, "openingCashMinor", "cashierUserId", "openedAt"
        FROM "CashShift"
        WHERE id = ${shiftId}
          AND "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
        FOR UPDATE
      `;

      if (shifts.length === 0) {
        throw new NotFoundException(`Cash shift ${shiftId} not found`);
      }

      const shift = shifts[0];

      if (shift.status === 'CLOSED') {
        throw new ConflictException('Shift is already closed');
      }

      const currentVersion = Number(shift.version);
      if (currentVersion !== expectedVersion) {
        throw new ConflictException(
          `Version conflict: expected ${expectedVersion}, got ${currentVersion}. Refresh and retry.`,
        );
      }

      // Compute expectedCashMinor from opening cash + confirmed CASH payments attributed to this shift
      const paymentAgg = await tx.$queryRaw<Array<{ total: bigint; count: bigint }>>`
        SELECT COALESCE(SUM("amountMinor"), 0) as total, COUNT(*) as count
        FROM "Payment"
        WHERE "cashierShiftId" = ${shiftId}
          AND status = 'APPROVED'
          AND method = 'CASH'
      `;

      const approvedCashMinor = Number(paymentAgg[0].total);
      const expectedCashMinor = Number(shift.openingCashMinor) + approvedCashMinor;
      const paymentCount = Number(paymentAgg[0].count);

      // Count orders
      const orderCount = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT "orderId") as count
        FROM "Payment"
        WHERE "cashierShiftId" = ${shiftId}
          AND status = 'APPROVED'
      `;

      // Count cancellations and voids during this shift
      const cancellationCount = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM "Order"
        WHERE "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
          AND status = 'CANCELLED'
          AND "confirmedAt" >= ${shift.openedAt}
      `;

      const voidCount = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM "Order"
        WHERE "tenantId" = ${tenantId}
          AND "branchId" = ${branchId}
          AND status = 'VOIDED'
          AND "confirmedAt" >= ${shift.openedAt}
      `;

      const varianceMinor = countedCashMinor - expectedCashMinor;

      // Validate variance reason for non-zero variance
      if (varianceMinor !== 0 && (!varianceReason || varianceReason.trim().length === 0)) {
        throw new BadRequestException('Variance reason is required for non-zero variance');
      }

      if (varianceReason && varianceReason.length > 255) {
        throw new BadRequestException('Variance reason must be 255 characters or less');
      }

      const now = new Date();
      const localBusinessDate = new Date(now.toISOString().split('T')[0]);

      // Close the shift
      await tx.cashShift.update({
        where: { id: shiftId },
        data: {
          status: 'CLOSED',
          expectedCashMinor: BigInt(expectedCashMinor),
          countedCashMinor: BigInt(countedCashMinor),
          varianceMinor: BigInt(varianceMinor),
          varianceReason: varianceReason ?? null,
          closedAt: now,
          closedByUserId: actorUserId,
          version: { increment: 1 },
        },
      });

      // Create immutable shift report snapshot
      const report = await tx.shiftReportSnapshot.create({
        data: {
          tenantId,
          branchId,
          cashShiftId: shiftId,
          openingCashMinor: shift.openingCashMinor,
          approvedCashMinor: BigInt(approvedCashMinor),
          expectedCashMinor: BigInt(expectedCashMinor),
          countedCashMinor: BigInt(countedCashMinor),
          varianceMinor: BigInt(varianceMinor),
          varianceReason: varianceReason ?? null,
          orderCount: Number(orderCount[0].count),
          paymentCount,
          cancellationCount: Number(cancellationCount[0].count),
          voidCount: Number(voidCount[0].count),
          localOpenedAt: shift.openedAt,
          localClosedAt: now,
          localBusinessDate,
          openedByUserId: shift.cashierUserId,
          closedByUserId: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'CASH_SHIFT_CLOSE',
          entityType: 'CashShift',
          entityId: shiftId,
          beforeJson: { status: 'OPEN', version: shift.version },
          afterJson: {
            status: 'CLOSED',
            expectedCashMinor,
            countedCashMinor,
            varianceMinor,
            paymentCount,
            orderCount: Number(orderCount[0].count),
          },
        },
      });

      const updatedShift = await tx.cashShift.findUnique({ where: { id: shiftId } });

      return { shift: updatedShift!, report };
    });

    return {
      shift: this.serializeShift(result.shift),
      report: this.serializeReport(result.report),
    };
  }

  /**
   * List shift reports for a branch, optionally filtered by cashier or date range.
   * Reports are immutable.
   */
  async listReports(params: {
    tenantId: string;
    branchId: string;
    cashierUserId?: string;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ShiftReportSnapshotData[]> {
    const { tenantId, branchId, cashierUserId, fromDate, toDate } = params;

    const where: any = { tenantId, branchId };
    if (cashierUserId) where.openedByUserId = cashierUserId;
    if (fromDate || toDate) {
      where.localBusinessDate = {};
      if (fromDate) where.localBusinessDate.gte = fromDate;
      if (toDate) where.localBusinessDate.lte = toDate;
    }

    const reports = await this.prisma.shiftReportSnapshot.findMany({
      where,
      orderBy: { localClosedAt: 'desc' },
    });

    return reports.map((r) => this.serializeReport(r));
  }

  /**
   * Get a single shift report by shift ID.
   */
  async getReport(params: {
    tenantId: string;
    branchId: string;
    cashShiftId: string;
  }): Promise<ShiftReportSnapshotData> {
    const { tenantId, branchId, cashShiftId } = params;

    const report = await this.prisma.shiftReportSnapshot.findUnique({
      where: { cashShiftId },
    });

    if (!report || report.tenantId !== tenantId || report.branchId !== branchId) {
      throw new NotFoundException('Shift report not found');
    }

    return this.serializeReport(report);
  }

  /**
   * Validate that an active shift exists for cash confirmation.
   * Used internally by PaymentService.
   */
  async requireActiveShift(params: {
    tenantId: string;
    branchId: string;
    cashierUserId: string;
  }): Promise<{ shiftId: string; shift: CashShiftSummary }> {
    const shift = await this.getCurrentShift(params);
    if (!shift) {
      throw new ConflictException('No active cash shift. Open a shift before confirming cash payments.');
    }
    return { shiftId: shift.id, shift };
  }

  /**
   * Associate a payment with a shift (called during cash confirmation).
   */
  async attributePayment(params: {
    tx: PrismaTransactionClient;
    paymentId: string;
    shiftId: string;
  }): Promise<void> {
    const { tx, paymentId, shiftId } = params;
    await tx.payment.update({
      where: { id: paymentId },
      data: { cashierShiftId: shiftId },
    });
  }

  private serializeShift(shift: {
    id: string;
    tenantId: string;
    branchId: string;
    cashierUserId: string;
    status: string;
    openingCashMinor: bigint;
    expectedCashMinor: bigint | null;
    countedCashMinor: bigint | null;
    varianceMinor: bigint | null;
    varianceReason: string | null;
    openedAt: Date;
    closedAt: Date | null;
    closedByUserId: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): CashShiftSummary {
    return {
      id: shift.id,
      tenantId: shift.tenantId,
      branchId: shift.branchId,
      cashierUserId: shift.cashierUserId,
      status: shift.status,
      openingCashMinor: Number(shift.openingCashMinor),
      expectedCashMinor: shift.expectedCashMinor !== null ? Number(shift.expectedCashMinor) : null,
      countedCashMinor: shift.countedCashMinor !== null ? Number(shift.countedCashMinor) : null,
      varianceMinor: shift.varianceMinor !== null ? Number(shift.varianceMinor) : null,
      varianceReason: shift.varianceReason,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      closedByUserId: shift.closedByUserId,
      version: shift.version,
      createdAt: shift.createdAt,
      updatedAt: shift.updatedAt,
    };
  }

  private serializeReport(report: any): ShiftReportSnapshotData {
    return {
      id: report.id,
      tenantId: report.tenantId,
      branchId: report.branchId,
      cashShiftId: report.cashShiftId,
      openingCashMinor: Number(report.openingCashMinor),
      approvedCashMinor: Number(report.approvedCashMinor),
      expectedCashMinor: Number(report.expectedCashMinor),
      countedCashMinor: Number(report.countedCashMinor),
      varianceMinor: Number(report.varianceMinor),
      varianceReason: report.varianceReason,
      orderCount: report.orderCount,
      paymentCount: report.paymentCount,
      cancellationCount: report.cancellationCount,
      voidCount: report.voidCount,
      localOpenedAt: report.localOpenedAt,
      localClosedAt: report.localClosedAt,
      localBusinessDate: report.localBusinessDate,
      openedByUserId: report.openedByUserId,
      closedByUserId: report.closedByUserId,
      createdAt: report.createdAt,
    };
  }
}
