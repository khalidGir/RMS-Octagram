import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';

const MAX_REPORTING_DAYS = 366;
const DEFAULT_TIMEZONE = 'Africa/Addis_Ababa';

interface DateRange {
  utcFrom: Date;
  utcTo: Date;
  effectiveTimezone: string;
}

interface BranchInfo {
  id: string;
  timezone: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  // ─── Date range helpers ─────────────────────

  private async resolveDateRange(
    tenantId: string,
    branchId: string | undefined,
    fromLocalDate: string | undefined,
    toLocalDate: string | undefined,
    timezone: string | undefined,
  ): Promise<DateRange> {
    let effectiveTimezone = timezone || DEFAULT_TIMEZONE;

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { timezone: true },
      });
      if (!branch) throw new BadRequestException('Branch not found');
      effectiveTimezone = timezone || branch.timezone || DEFAULT_TIMEZONE;
    }

    const now = new Date();
    const from = fromLocalDate
      ? this.localDateToUtc(fromLocalDate, effectiveTimezone)
      : new Date(now.getTime() - 30 * 86400_000);
    const to = toLocalDate
      ? this.localDateToEndOfDayUtc(toLocalDate, effectiveTimezone)
      : now;

    const diffDays = (to.getTime() - from.getTime()) / 86400_000;
    if (diffDays > MAX_REPORTING_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_REPORTING_DAYS} days`,
      );
    }
    if (from > to) {
      throw new BadRequestException('fromLocalDate must be before toLocalDate');
    }

    return { utcFrom: from, utcTo: to, effectiveTimezone };
  }

  private localDateToUtc(dateStr: string, tz: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) {
      throw new BadRequestException('Invalid date format');
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(Date.UTC(y, m - 1, d, 0, 0, 0)));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? '0');
    const tzDate = new Date(
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
    );
    const utcDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const offset = utcDate.getTime() - tzDate.getTime();
    return new Date(utcDate.getTime() + offset);
  }

  private localDateToEndOfDayUtc(dateStr: string, tz: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) {
      throw new BadRequestException('Invalid date format');
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(Date.UTC(y, m - 1, d, 23, 59, 59)));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? '0');
    const tzDate = new Date(
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
    );
    const utcDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    const offset = utcDate.getTime() - tzDate.getTime();
    return new Date(utcDate.getTime() + offset);
  }

  // ─── Scope helpers ──────────────────────────

  private async resolveBranches(
    tenantId: string,
    branchId: string | undefined,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    requestedBranchIds?: string,
  ): Promise<BranchInfo[]> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { id: true, timezone: true },
      });
      if (!branch) throw new BadRequestException('Branch not found');
      return [branch];
    }

    if (tenantRole === 'OWNER') {
      if (requestedBranchIds) {
        const ids = requestedBranchIds.split(',').filter(Boolean);
        const branches = await this.prisma.branch.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, timezone: true },
        });
        return branches;
      }
      return this.prisma.branch.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, timezone: true },
      });
    }

    if (tenantRole === 'MANAGER' && branchIds?.length) {
      return this.prisma.branch.findMany({
        where: { id: { in: branchIds }, tenantId },
        select: { id: true, timezone: true },
      });
    }

    throw new ForbiddenException('Insufficient permissions for analytics');
  }

  private async assertAnalytics(tenantId: string, branchId?: string) {
    await this.featureResolver.assertEffective(tenantId, FeatureKey.ANALYTICS, branchId);
  }

  private branchScope(qualifiedColumn: string, branchId: string | undefined, branches: BranchInfo[]): Prisma.Sql {
    if (branchId) {
      return Prisma.sql`AND ${Prisma.raw(qualifiedColumn)} = ${branchId}`;
    }
    const ids = branches.map((b) => b.id);
    return Prisma.sql`AND ${Prisma.raw(qualifiedColumn)} IN (${Prisma.join(ids)})`;
  }

  // ─── Report implementations ─────────────────

  async revenueSummary(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return {
        timezone: params.timezone || DEFAULT_TIMEZONE,
        fromLocalDate: params.fromLocalDate || '',
        toLocalDate: params.toLocalDate || '',
        days: [],
      };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );

    const scope = this.branchScope('o."branchId"', params.branchId, branches);

    const rows = await this.prisma.$queryRaw<
      Array<{
        day: string;
        revenue_minor: string;
        order_count: string;
        avg_order_minor: string;
      }>
    >`
      SELECT
        TO_CHAR(o."createdAt" AT TIME ZONE ${effectiveTimezone}, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(p."amountMinor"), 0)::text AS revenue_minor,
        COUNT(DISTINCT o."id")::text AS order_count,
        CASE WHEN COUNT(DISTINCT o."id") > 0
          THEN (SUM(p."amountMinor") / COUNT(DISTINCT o."id"))::text
          ELSE '0'
        END AS avg_order_minor
      FROM "Order" o
      JOIN "Payment" p ON p."orderId" = o."id"
        AND p."status" = 'APPROVED'
      WHERE o."tenantId" = ${tenantId}
        AND o."status" NOT IN ('CANCELLED', 'VOIDED')
        AND p."createdAt" >= ${utcFrom}
        AND p."createdAt" < ${utcTo}
        ${scope}
      GROUP BY day
      ORDER BY day ASC
    `;

    return {
      timezone: effectiveTimezone,
      fromLocalDate: params.fromLocalDate || '',
      toLocalDate: params.toLocalDate || '',
      days: rows.map((r) => ({
        date: r.day,
        revenueMinor: r.revenue_minor,
        currency: 'ETB',
        orderCount: Number(r.order_count),
        avgOrderMinor: r.avg_order_minor,
      })),
    };
  }

  async revenueByPaymentMethod(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return {
        timezone: params.timezone || DEFAULT_TIMEZONE,
        methods: [],
      };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );

    const scope = this.branchScope('o."branchId"', params.branchId, branches);

    const rows = await this.prisma.$queryRaw<
      Array<{
        method: string;
        total_minor: string;
        payment_count: string;
        avg_minor: string;
      }>
    >`
      SELECT
        p."method",
        SUM(p."amountMinor")::text AS total_minor,
        COUNT(*)::text AS payment_count,
        CASE WHEN COUNT(*) > 0
          THEN (SUM(p."amountMinor") / COUNT(*))::text
          ELSE '0'
        END AS avg_minor
      FROM "Payment" p
      JOIN "Order" o ON o."id" = p."orderId"
      WHERE o."tenantId" = ${tenantId}
        AND o."status" NOT IN ('CANCELLED', 'VOIDED')
        AND p."status" = 'APPROVED'
        AND p."createdAt" >= ${utcFrom}
        AND p."createdAt" < ${utcTo}
        ${scope}
      GROUP BY p."method"
      ORDER BY SUM(p."amountMinor") DESC
    `;

    return {
      timezone: effectiveTimezone,
      methods: rows.map((r) => ({
        method: r.method,
        totalMinor: r.total_minor,
        currency: 'ETB',
        paymentCount: Number(r.payment_count),
        avgMinor: r.avg_minor,
      })),
    };
  }

  async orderStats(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return {
        timezone: params.timezone || DEFAULT_TIMEZONE,
        stats: {
          totalOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          voidedOrders: 0,
          avgOrderMinor: '0',
          totalRevenueMinor: '0',
          currency: 'ETB',
        },
      };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );

    const scope = this.branchScope('o."branchId"', params.branchId, branches);

    const rows = await this.prisma.$queryRaw<
      Array<{
        total_orders: string;
        completed_orders: string;
        cancelled_orders: string;
        voided_orders: string;
        avg_order_minor: string;
        total_revenue_minor: string;
      }>
    >`
      SELECT
        COUNT(*)::text AS total_orders,
        COUNT(*) FILTER (WHERE o."status" IN ('CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED'))::text AS completed_orders,
        COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::text AS cancelled_orders,
        COUNT(*) FILTER (WHERE o."status" = 'VOIDED')::text AS voided_orders,
        COALESCE(AVG(o."totalMinor") FILTER (WHERE o."status" NOT IN ('CANCELLED', 'VOIDED')), 0)::text AS avg_order_minor,
        COALESCE(SUM(o."totalMinor") FILTER (WHERE o."status" NOT IN ('CANCELLED', 'VOIDED')), 0)::text AS total_revenue_minor
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND o."createdAt" >= ${utcFrom}
        AND o."createdAt" < ${utcTo}
        ${scope}
    `;

    const r = rows[0];
    return {
      timezone: effectiveTimezone,
      stats: {
        totalOrders: Number(r.total_orders),
        completedOrders: Number(r.completed_orders),
        cancelledOrders: Number(r.cancelled_orders),
        voidedOrders: Number(r.voided_orders),
        avgOrderMinor: r.avg_order_minor,
        totalRevenueMinor: r.total_revenue_minor,
        currency: 'ETB',
      },
    };
  }

  async bestSellers(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
      limit?: number;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return { timezone: params.timezone || DEFAULT_TIMEZONE, items: [] };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );
    const scope = this.branchScope('ol."branchId"', params.branchId, branches);

    const limit = Math.max(1, Math.min(100, params.limit || 20));

    const rows = await this.prisma.$queryRaw<
      Array<{
        variant_id: string;
        item_name: string;
        variant_name: string;
        total_quantity: string;
        total_revenue: string;
        order_count: string;
      }>
    >`
      SELECT
        ol."variantId" AS variant_id,
        ol."itemNameSnapshot" AS item_name,
        ol."variantNameSnapshot" AS variant_name,
        SUM(ol."quantity")::text AS total_quantity,
        SUM(ol."lineTotalMinor")::text AS total_revenue,
        COUNT(DISTINCT ol."orderId")::text AS order_count
      FROM "OrderLine" ol
      JOIN "Order" o ON o."id" = ol."orderId"
      WHERE o."tenantId" = ${tenantId}
        AND o."status" NOT IN ('CANCELLED', 'VOIDED')
        AND o."createdAt" >= ${utcFrom}
        AND o."createdAt" < ${utcTo}
        ${scope}
      GROUP BY ol."variantId", ol."itemNameSnapshot", ol."variantNameSnapshot"
      ORDER BY SUM(ol."quantity") DESC, ol."itemNameSnapshot" ASC
      LIMIT ${BigInt(limit)}
    `;

    return {
      timezone: effectiveTimezone,
      items: rows.map((r) => ({
        variantId: r.variant_id,
        itemName: r.item_name,
        variantName: r.variant_name,
        totalQuantity: Number(r.total_quantity),
        totalRevenueMinor: r.total_revenue,
        currency: 'ETB',
        orderCount: Number(r.order_count),
      })),
    };
  }

  async peakHours(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return { timezone: params.timezone || DEFAULT_TIMEZONE, hours: [] };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );

    const scope = this.branchScope('o."branchId"', params.branchId, branches);

    const rows = await this.prisma.$queryRaw<
      Array<{
        hour: string;
        order_count: string;
        revenue_minor: string;
      }>
    >`
      SELECT
        EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE ${effectiveTimezone})::text AS hour,
        COUNT(*)::text AS order_count,
        COALESCE(SUM(o."totalMinor"), 0)::text AS revenue_minor
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND o."status" NOT IN ('CANCELLED', 'VOIDED')
        AND o."createdAt" >= ${utcFrom}
        AND o."createdAt" < ${utcTo}
        ${scope}
      GROUP BY hour
      ORDER BY hour ASC
    `;

    const hoursMap = new Map<string, { hour: string; orderCount: number; revenueMinor: string }>();
    for (let h = 0; h < 24; h++) {
      hoursMap.set(String(h), { hour: String(h), orderCount: 0, revenueMinor: '0' });
    }
    for (const r of rows) {
      const h = String(Number(r.hour));
      hoursMap.set(h, {
        hour: h,
        orderCount: Number(r.order_count),
        revenueMinor: r.revenue_minor,
      });
    }

    return {
      timezone: effectiveTimezone,
      hours: Array.from(hoursMap.values()),
    };
  }

  async inventoryConsumption(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
      fromLocalDate?: string;
      toLocalDate?: string;
      timezone?: string;
      movementType?: string;
      inventoryItemId?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return { timezone: params.timezone || DEFAULT_TIMEZONE, items: [] };
    }

    const { utcFrom, utcTo, effectiveTimezone } = await this.resolveDateRange(
      tenantId,
      params.branchId,
      params.fromLocalDate,
      params.toLocalDate,
      params.timezone,
    );

    const scope = this.branchScope('im."branchId"', params.branchId, branches);

    const typeFilter = params.movementType
      ? Prisma.sql`AND im."movementType" = ${params.movementType}`
      : Prisma.empty;

    const itemFilter = params.inventoryItemId
      ? Prisma.sql`AND im."inventoryItemId" = ${params.inventoryItemId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        inventory_item_id: string;
        item_name: string;
        movement_type: string;
        total_quantity: string;
        movement_count: string;
      }>
    >`
      SELECT
        im."inventoryItemId" AS inventory_item_id,
        ii."name" AS item_name,
        im."movementType" AS movement_type,
        SUM(im."quantity")::text AS total_quantity,
        COUNT(*)::text AS movement_count
      FROM "InventoryMovement" im
      JOIN "InventoryItem" ii ON ii."id" = im."inventoryItemId"
      WHERE im."tenantId" = ${tenantId}
        AND im."createdAt" >= ${utcFrom}
        AND im."createdAt" < ${utcTo}
        ${scope}
        ${typeFilter}
        ${itemFilter}
      GROUP BY im."inventoryItemId", ii."name", im."movementType"
      ORDER BY ii."name" ASC, im."movementType" ASC
    `;

    return {
      timezone: effectiveTimezone,
      items: rows.map((r) => ({
        inventoryItemId: r.inventory_item_id,
        itemName: r.item_name,
        movementType: r.movement_type,
        totalQuantity: r.total_quantity,
        movementCount: Number(r.movement_count),
      })),
    };
  }

  async lowStockSnapshot(
    tenantId: string,
    tenantRole: string | undefined,
    branchIds: string[] | undefined,
    params: {
      branchId?: string;
    },
  ) {
    await this.assertAnalytics(tenantId, params.branchId);
    const branches = await this.resolveBranches(
      tenantId,
      params.branchId,
      tenantRole,
      branchIds,
    );
    if (branches.length === 0) {
      return { items: [] };
    }

    const scope = this.branchScope('ii."branchId"', params.branchId, branches);

    const rows = await this.prisma.$queryRaw<
      Array<{
        inventory_item_id: string;
        item_name: string;
        base_unit: string;
        current_stock: string;
        threshold: string;
        is_low: boolean;
        branch_id: string;
        branch_name: string;
      }>
    >`
      SELECT
        ii."id" AS inventory_item_id,
        ii."name" AS item_name,
        ii."baseUnit" AS base_unit,
        COALESCE(SUM(ib."remainingQuantity"), 0)::text AS current_stock,
        ii."lowStockThreshold"::text AS threshold,
        CASE WHEN ii."lowStockThreshold" > 0
             AND COALESCE(SUM(ib."remainingQuantity"), 0) <= ii."lowStockThreshold"
          THEN true ELSE false
        END AS is_low,
        ii."branchId" AS branch_id,
        b."name" AS branch_name
      FROM "InventoryItem" ii
      JOIN "Branch" b ON b."id" = ii."branchId"
      LEFT JOIN "InventoryBatch" ib ON ib."inventoryItemId" = ii."id"
      WHERE ii."tenantId" = ${tenantId}
        AND ii."isActive" = true
        ${scope}
      GROUP BY ii."id", ii."name", ii."baseUnit", ii."lowStockThreshold", ii."branchId", b."name"
      HAVING ii."lowStockThreshold" > 0
        AND COALESCE(SUM(ib."remainingQuantity"), 0) <= ii."lowStockThreshold"
      ORDER BY COALESCE(SUM(ib."remainingQuantity"), 0) ASC
    `;

    return {
      items: rows.map((r) => ({
        inventoryItemId: r.inventory_item_id,
        itemName: r.item_name,
        baseUnit: r.base_unit,
        currentStock: r.current_stock,
        threshold: r.threshold,
        isLow: r.is_low,
        branchId: r.branch_id,
        branchName: r.branch_name,
      })),
    };
  }
}
