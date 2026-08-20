import {
  Injectable,
  NotFoundException,
  ConflictException,
  NotImplementedException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Services are used as constructor values
import { BranchOrderCounterService } from './branch-order-counter.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Services are used as constructor values
import { IdempotencyService } from './idempotency.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Services are used as constructor values
import { PriceCalculatorService } from './price-calculator.service';
import type { LineInput } from './price-calculator.service';
import { canTransition3A, getInitialStatus } from './state-machine';
import * as crypto from 'crypto';
import { FeatureKey } from '@rms/contracts';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counter: BranchOrderCounterService,
    private readonly idempotency: IdempotencyService,
    private readonly priceCalc: PriceCalculatorService,
  ) {}

  // ─── CREATE TABLE ORDER (Public) ─────────────

  async createTableOrder(params: {
    tenantId: string;
    branchId: string;
    tableId: string;
    diningSessionId?: string;
    lines: LineInput[];
    notes?: string;
    customerName?: string;
    customerPhone?: string;
    idempotencyKey?: string;
    quotedTotal?: string;
  }): Promise<{ order: Record<string, unknown>; trackingTokenRaw: string }> {
    const { tenantId, branchId, tableId, idempotencyKey } = params;

    // Verify branch is active
    await this.assertBranchActive(tenantId, branchId);

    // Verify TABLE_QR_ORDERING feature is enabled
    await this.assertFeatureEnabled(tenantId, branchId, FeatureKey.TABLE_QR_ORDERING);

    // Merge duplicate lines (same variant + modifiers → sum quantity, keep first notes)
    const lines = this.deduplicateLines(params.lines);

    // Calculate cart
    const calculation = await this.priceCalc.calculateCart(tenantId, branchId, lines);

    // Check stale-cart detection
    if (params.quotedTotal) {
      const quoted = BigInt(params.quotedTotal);
      if (quoted !== calculation.subtotalMinor) {
        throw new ConflictException({
          code: 'PRICE_CHANGED',
          message: 'Cart prices have changed. Please review and confirm.',
          serverTotal: calculation.subtotalMinor.toString(),
          lines: calculation.lines.map((l) => ({
            variantId: l.variantId,
            lineTotal: l.lineTotalMinor.toString(),
          })),
        });
      }
    }

    // Resolve payment policy
    const paymentPolicy = await this.getPaymentPolicy(tenantId, branchId);
    const initialStatus = getInitialStatus(paymentPolicy);

    // Generate tracking token
    const { raw: trackingTokenRaw, hash: trackingTokenHash } = this.generateTrackingToken();

    // Resolve or create dining session
    const diningSessionId = params.diningSessionId ?? undefined;

    const execute = async () => {
      const order = await this.prisma.$transaction(async (tx) => {
        // Generate order number
        const orderNumber = await this.counter.nextOrderNumber(tx, branchId);

        // Create order
        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            orderNumber,
            orderType: 'DINE_IN',
            status: initialStatus,
            diningSessionId: diningSessionId ?? null,
            tableId,
            customerName: params.customerName ?? null,
            customerPhone: params.customerPhone ?? null,
            currency: 'ETB',
            subtotalMinor: calculation.subtotalMinor,
            discountMinor: 0n,
            taxMinor: 0n,
            serviceChargeMinor: 0n,
            totalMinor: calculation.subtotalMinor,
            notes: params.notes ?? null,
            source: 'CUSTOMER_WEB',
            trackingTokenHash,
            version: 1,
          },
        });

        // Create order lines with snapshots
        for (const line of calculation.lines) {
          const orderLine = await tx.orderLine.create({
            data: {
              tenantId,
              branchId,
              orderId: order.id,
              menuItemId: line.menuItemId,
              variantId: line.variantId,
              itemNameSnapshot: line.itemNameSnapshot,
              variantNameSnapshot: line.variantNameSnapshot,
              skuSnapshot: line.skuSnapshot,
              unitPriceMinor: line.unitPriceMinor,
              quantity: line.quantity,
              lineTotalMinor: line.lineTotalMinor,
              notes: lines.find((l) => l.variantId === line.variantId)?.notes ?? null,
            },
          });

          // Create modifier snapshots
          for (const mod of line.modifiers) {
            await tx.orderLineModifier.create({
              data: {
                tenantId,
                branchId,
                orderLineId: orderLine.id,
                modifierOptionId: mod.modifierOptionId,
                nameSnapshot: mod.nameSnapshot,
                unitPriceDeltaMinor: mod.unitPriceDeltaMinor,
                quantity: mod.quantity,
                totalDeltaMinor: mod.totalDeltaMinor,
              },
            });
          }
        }

        // Append status history
        await tx.orderStatusHistory.create({
          data: {
            tenantId,
            branchId,
            orderId: order.id,
            fromStatus: null,
            toStatus: initialStatus,
            actorUserId: null,
          },
        });

        // Create outbox event
        await tx.outboxEvent.create({
          data: {
            tenantId,
            branchId,
            aggregateType: 'Order',
            aggregateId: order.id,
            eventType: 'order.created',
            payload: {
              orderId: order.id,
              orderNumber: orderNumber.toString(),
              status: initialStatus,
              totalMinor: calculation.subtotalMinor.toString(),
              tableId,
            },
          },
        });

        // Audit within transaction
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            tenantId,
            branchId,
            action: 'ORDER_CREATE',
            entityType: 'Order',
            entityId: order.id,
            afterJson: {
              orderNumber: orderNumber.toString(),
              status: initialStatus,
              totalMinor: calculation.subtotalMinor.toString(),
              lineCount: calculation.lines.length,
              source: 'CUSTOMER_WEB',
            },
          },
        });

        return order;
      });

      return {
        status: 201 as const,
        body: { ...this.serializeOrder(order), trackingToken: trackingTokenRaw },
        resourceId: order.id,
      };
    };

    // Wrap in idempotency if key provided
    if (idempotencyKey) {
      const { result } = await this.idempotency.withIdempotency(
        {
          tenantId,
          branchId,
          operation: 'createTableOrder',
          key: idempotencyKey,
          requestPayload: params,
        },
        execute,
      );
      const body = result.body as Record<string, unknown>;
      const { trackingToken: _token, ...orderBody } = body;
      return { order: orderBody, trackingTokenRaw: _token as string };
    }

    const result = await execute();
    const body = result.body as Record<string, unknown>;
    const { trackingToken: _token, ...orderBody } = body;
    return { order: orderBody, trackingTokenRaw: _token as string };
  }

  // ─── CREATE POS ORDER ───────────────────────

  async createPosOrder(params: {
    tenantId: string;
    branchId: string;
    tableId?: string;
    diningSessionId?: string;
    lines: LineInput[];
    notes?: string;
    orderType: string;
    createdByUserId: string;
    idempotencyKey?: string;
    quotedTotal?: string;
  }): Promise<{ order: Record<string, unknown> }> {
    const { tenantId, branchId, createdByUserId, idempotencyKey } = params;

    await this.assertBranchActive(tenantId, branchId);

    // Reject tableId for POS and PICKUP order types
    if ((params.orderType === 'POS' || params.orderType === 'PICKUP') && params.tableId) {
      throw new ConflictException(`tableId is not allowed for ${params.orderType} orders`);
    }

    // DINE_IN requires tableId
    if (params.orderType === 'DINE_IN' && !params.tableId) {
      throw new ConflictException('tableId is required for DINE_IN orders');
    }

    // Validate table belongs to this tenant/branch and is active
    if (params.tableId) {
      const table = await this.prisma.restaurantTable.findFirst({
        where: { id: params.tableId, tenantId, branchId, isActive: true },
      });
      if (!table) {
        throw new NotFoundException('Table not found or inactive');
      }
    }

    // Merge duplicate lines (same variant + modifiers → sum quantity, keep first notes)
    const lines = this.deduplicateLines(params.lines);

    // Calculate cart
    const calculation = await this.priceCalc.calculateCart(tenantId, branchId, lines);

    // Check stale-cart detection
    if (params.quotedTotal) {
      const quoted = BigInt(params.quotedTotal);
      if (quoted !== calculation.subtotalMinor) {
        throw new ConflictException({
          code: 'PRICE_CHANGED',
          message: 'Cart prices have changed. Please review and confirm.',
          serverTotal: calculation.subtotalMinor.toString(),
        });
      }
    }

    // POS orders default to PENDING_CONFIRMATION (cashier will confirm)
    const initialStatus = 'PENDING_CONFIRMATION' as const;

    const execute = async () => {
      const order = await this.prisma.$transaction(async (tx) => {
        const orderNumber = await this.counter.nextOrderNumber(tx, branchId);

        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            orderNumber,
            orderType: params.orderType,
            status: initialStatus,
            diningSessionId: params.diningSessionId ?? null,
            tableId: params.tableId ?? null,
            currency: 'ETB',
            subtotalMinor: calculation.subtotalMinor,
            discountMinor: 0n,
            taxMinor: 0n,
            serviceChargeMinor: 0n,
            totalMinor: calculation.subtotalMinor,
            notes: params.notes ?? null,
            source: 'CASHIER_POS',
            createdByUserId,
            version: 1,
          },
        });

        for (const line of calculation.lines) {
          const orderLine = await tx.orderLine.create({
            data: {
              tenantId,
              branchId,
              orderId: order.id,
              menuItemId: line.menuItemId,
              variantId: line.variantId,
              itemNameSnapshot: line.itemNameSnapshot,
              variantNameSnapshot: line.variantNameSnapshot,
              skuSnapshot: line.skuSnapshot,
              unitPriceMinor: line.unitPriceMinor,
              quantity: line.quantity,
              lineTotalMinor: line.lineTotalMinor,
              notes: lines.find((l) => l.variantId === line.variantId)?.notes ?? null,
            },
          });

          for (const mod of line.modifiers) {
            await tx.orderLineModifier.create({
              data: {
                tenantId,
                branchId,
                orderLineId: orderLine.id,
                modifierOptionId: mod.modifierOptionId,
                nameSnapshot: mod.nameSnapshot,
                unitPriceDeltaMinor: mod.unitPriceDeltaMinor,
                quantity: mod.quantity,
                totalDeltaMinor: mod.totalDeltaMinor,
              },
            });
          }
        }

        await tx.orderStatusHistory.create({
          data: {
            tenantId,
            branchId,
            orderId: order.id,
            fromStatus: null,
            toStatus: initialStatus,
            actorUserId: createdByUserId,
          },
        });

        await tx.outboxEvent.create({
          data: {
            tenantId,
            branchId,
            aggregateType: 'Order',
            aggregateId: order.id,
            eventType: 'order.created',
            payload: {
              orderId: order.id,
              orderNumber: orderNumber.toString(),
              status: initialStatus,
              totalMinor: calculation.subtotalMinor.toString(),
              source: 'CASHIER_POS',
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: createdByUserId,
            tenantId,
            branchId,
            action: 'ORDER_CREATE_POS',
            entityType: 'Order',
            entityId: order.id,
            afterJson: {
              orderNumber: orderNumber.toString(),
              status: initialStatus,
              totalMinor: calculation.subtotalMinor.toString(),
              lineCount: calculation.lines.length,
              source: 'CASHIER_POS',
            },
          },
        });

        return order;
      });

      return { status: 201 as const, body: this.serializeOrder(order), resourceId: order.id };
    };

    if (idempotencyKey) {
      const { result } = await this.idempotency.withIdempotency(
        {
          tenantId,
          branchId,
          operation: 'createPosOrder',
          key: idempotencyKey,
          requestPayload: params,
        },
        execute,
      );
      return { order: result.body as Record<string, unknown> };
    }

    const result = await execute();
    return { order: result.body as Record<string, unknown> };
  }

  // ─── EDIT ORDER (Atomic) ────────────────────

  async editOrder(params: {
    orderId: string;
    tenantId: string;
    branchId: string;
    lines: LineInput[];
    notes?: string;
    expectedVersion: number;
    actorUserId: string;
    idempotencyKey?: string;
    quotedTotal?: string;
  }): Promise<{ order: Record<string, unknown> }> {
    const { orderId, tenantId, branchId, expectedVersion, actorUserId } = params;

    // Load existing order
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
      include: { lines: { include: { modifiers: true } } },
    });
    if (!existing) throw new NotFoundException('Order not found');

    // Check status allows editing
    if (!['DRAFT', 'PENDING_PAYMENT', 'PENDING_CONFIRMATION'].includes(existing.status)) {
      throw new ConflictException(`Cannot edit order in status ${existing.status}`);
    }

    // Check version
    if (existing.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'The order has been modified by another request. Please refresh.',
        currentVersion: existing.version,
      });
    }

    // Calculate new cart
    const lines = this.deduplicateLines(params.lines);
    const calculation = await this.priceCalc.calculateCart(tenantId, branchId, lines);

    // Check stale-cart detection
    if (params.quotedTotal) {
      const quoted = BigInt(params.quotedTotal);
      if (quoted !== calculation.subtotalMinor) {
        throw new ConflictException({
          code: 'PRICE_CHANGED',
          message: 'Cart prices have changed. Please review and confirm.',
          serverTotal: calculation.subtotalMinor.toString(),
        });
      }
    }

    const execute = async () => {
      const order = await this.prisma.$transaction(async (tx) => {
        // Delete existing modifiers and lines
        const existingLineIds = existing.lines.map((l) => l.id);
        if (existingLineIds.length > 0) {
          await tx.orderLineModifier.deleteMany({
            where: { orderLineId: { in: existingLineIds } },
          });
          await tx.orderLine.deleteMany({
            where: { orderId },
          });
        }

        // Create new lines
        for (const line of calculation.lines) {
          const orderLine = await tx.orderLine.create({
            data: {
              tenantId,
              branchId,
              orderId,
              menuItemId: line.menuItemId,
              variantId: line.variantId,
              itemNameSnapshot: line.itemNameSnapshot,
              variantNameSnapshot: line.variantNameSnapshot,
              skuSnapshot: line.skuSnapshot,
              unitPriceMinor: line.unitPriceMinor,
              quantity: line.quantity,
              lineTotalMinor: line.lineTotalMinor,
              notes: lines.find((l) => l.variantId === line.variantId)?.notes ?? null,
            },
          });

          for (const mod of line.modifiers) {
            await tx.orderLineModifier.create({
              data: {
                tenantId,
                branchId,
                orderLineId: orderLine.id,
                modifierOptionId: mod.modifierOptionId,
                nameSnapshot: mod.nameSnapshot,
                unitPriceDeltaMinor: mod.unitPriceDeltaMinor,
                quantity: mod.quantity,
                totalDeltaMinor: mod.totalDeltaMinor,
              },
            });
          }
        }

        // Update order totals and version
        const updated = await tx.order.update({
          where: { id: orderId, version: expectedVersion },
          data: {
            subtotalMinor: calculation.subtotalMinor,
            totalMinor: calculation.subtotalMinor,
            notes: params.notes ?? existing.notes,
            version: { increment: 1 },
          },
        });

        // Append status history
        await tx.orderStatusHistory.create({
          data: {
            tenantId,
            branchId,
            orderId,
            fromStatus: existing.status,
            toStatus: existing.status, // Status doesn't change on edit
            actorUserId,
            metadata: { action: 'edit', lineCount: calculation.lines.length },
          },
        });

        // Audit within transaction
        await tx.auditLog.create({
          data: {
            actorUserId,
            tenantId,
            branchId,
            action: 'ORDER_EDIT',
            entityType: 'Order',
            entityId: orderId,
            beforeJson: {
              totalMinor: existing.totalMinor.toString(),
              version: existing.version,
            },
            afterJson: {
              totalMinor: calculation.subtotalMinor.toString(),
              version: updated.version,
            },
          },
        });

        return updated;
      });

      return { status: 200 as const, body: this.serializeOrder(order), resourceId: order.id };
    };

    if (params.idempotencyKey) {
      const { result } = await this.idempotency.withIdempotency(
        {
          tenantId,
          branchId,
          operation: 'editOrder',
          key: params.idempotencyKey,
          requestPayload: params,
        },
        execute,
      );
      return { order: result.body as Record<string, unknown> };
    }

    const result = await execute();
    return { order: result.body as Record<string, unknown> };
  }

  // ─── CANCEL ORDER ───────────────────────────

  async cancelOrder(params: {
    orderId: string;
    tenantId: string;
    branchId: string;
    actorUserId: string;
    reason?: string;
    expectedVersion: number;
  }): Promise<{ order: Record<string, unknown> }> {
    const { orderId, tenantId, branchId, actorUserId, reason, expectedVersion } = params;

    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Order not found');

    if (!canTransition3A(existing.status, 'CANCELLED')) {
      throw new ConflictException(
        `Cannot cancel order in status ${existing.status}`,
      );
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'The order has been modified by another request. Please refresh.',
        currentVersion: existing.version,
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId, version: existing.version },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: existing.status,
          toStatus: 'CANCELLED',
          actorUserId,
          reason,
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.cancelled',
          payload: { orderId, reason },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_CANCEL',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { status: existing.status },
          afterJson: { status: 'CANCELLED', reason },
        },
      });

      return updated;
    });

    return { order: this.serializeOrder(order) };
  }

  // ─── CONFIRM ORDER (Disabled in 3A) ─────────

  async confirmOrder(): Promise<never> {
    throw new NotImplementedException(
      'Order confirmation workflow is not yet available. Orders will be confirmed automatically when payment is processed.',
    );
  }

  // ─── GET ORDER (with service-level branch auth) ──

  async getOrder(params: {
    orderId: string;
    tenantId: string;
    callerBranchIds: string[];
    callerIsOwner: boolean;
  }): Promise<Record<string, unknown>> {
    const { orderId, tenantId, callerBranchIds, callerIsOwner } = params;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        lines: { include: { modifiers: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Service-level branch authorization
    if (!callerIsOwner && !callerBranchIds.includes(order.branchId)) {
      throw new NotFoundException('Order not found');
    }

    return this.serializeOrder(order);
  }

  // ─── LIST ORDERS ────────────────────────────

  async listOrders(params: {
    tenantId: string;
    branchId: string;
    status?: string;
    orderType?: string;
    from?: Date;
    to?: Date;
    limit: number;
    after?: string;
  }): Promise<{ orders: Record<string, unknown>[]; nextCursor?: string }> {
    const { tenantId, branchId, status, orderType, from, to, limit, after } = params;

    const where: Record<string, unknown> = { tenantId, branchId };
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, Date>).gte = from;
      if (to) (where.createdAt as Record<string, Date>).lte = to;
    }
    if (after) {
      where.createdAt = { ...(where.createdAt as Record<string, unknown>), lt: new Date(after) };
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        lines: true,
      },
    });

    let nextCursor: string | undefined;
    if (orders.length > limit) {
      const last = orders.pop()!;
      nextCursor = last.createdAt.toISOString();
    }

    return {
      orders: orders.map((o) => this.serializeOrder(o)),
      nextCursor,
    };
  }

  // ─── TRACK ORDER (Public) ───────────────────

  async trackOrder(params: {
    trackingToken: string;
  }): Promise<Record<string, unknown>> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(params.trackingToken)
      .digest('hex');

    const order = await this.prisma.order.findFirst({
      where: { trackingTokenHash: tokenHash },
      include: {
        lines: { include: { modifiers: true } },
        statusHistory: { orderBy: { createdAt: 'asc' }, take: 5 },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Return safe subset (no sensitive data)
    return {
      id: order.id,
      orderNumber: order.orderNumber.toString(),
      status: order.status,
      totalMinor: order.totalMinor.toString(),
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      lines: order.lines.map((l) => ({
        itemName: l.itemNameSnapshot,
        variantName: l.variantNameSnapshot,
        quantity: l.quantity,
        lineTotalMinor: l.lineTotalMinor.toString(),
      })),
      statusHistory: order.statusHistory.map((h) => ({
        status: h.toStatus,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  // ─── PRIVATE HELPERS ────────────────────────

  private generateTrackingToken(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  private serializeOrder(order: Record<string, unknown>): Record<string, unknown> {
    const o = order as any;
    return {
      ...o,
      orderNumber: o.orderNumber?.toString() ?? o.orderNumber,
      subtotalMinor: o.subtotalMinor?.toString() ?? o.subtotalMinor,
      discountMinor: o.discountMinor?.toString() ?? o.discountMinor,
      taxMinor: o.taxMinor?.toString() ?? o.taxMinor,
      serviceChargeMinor: o.serviceChargeMinor?.toString() ?? o.serviceChargeMinor,
      totalMinor: o.totalMinor?.toString() ?? o.totalMinor,
      lines: o.lines?.map((l: any) => ({
        ...l,
        unitPriceMinor: l.unitPriceMinor?.toString() ?? l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor?.toString() ?? l.lineTotalMinor,
        modifiers: l.modifiers?.map((m: any) => ({
          ...m,
          unitPriceDeltaMinor: m.unitPriceDeltaMinor?.toString() ?? m.unitPriceDeltaMinor,
          totalDeltaMinor: m.totalDeltaMinor?.toString() ?? m.totalDeltaMinor,
        })),
      })),
    };
  }

  private async assertBranchActive(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, isActive: true },
    });
    if (!branch) throw new NotFoundException('Branch not found or inactive');
  }

  private async assertFeatureEnabled(
    tenantId: string,
    branchId: string,
    featureKey: FeatureKey,
  ): Promise<void> {
    // Check branch override first
    const branchSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId, featureKey },
    });
    if (branchSetting) {
      if (!branchSetting.enabled) {
        throw new ConflictException(`Feature ${featureKey} is disabled for this branch`);
      }
      return;
    }

    // Check tenant default
    const tenantSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId: null, featureKey },
    });
    if (tenantSetting && !tenantSetting.enabled) {
      throw new ConflictException(`Feature ${featureKey} is disabled`);
    }
  }

  private async getPaymentPolicy(tenantId: string, branchId: string): Promise<string> {
    // Check branch override first
    const branchSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId, featureKey: 'PAYMENT_POLICY' },
    });
    if (branchSetting) {
      return (branchSetting.configuration as any)?.policy ?? 'PREPAY_REQUIRED';
    }

    // Check tenant default
    const tenantSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId: null, featureKey: 'PAYMENT_POLICY' },
    });
    if (tenantSetting) {
      return (tenantSetting.configuration as any)?.policy ?? 'PREPAY_REQUIRED';
    }

    return 'PREPAY_REQUIRED';
  }

  private deduplicateLines(lines: LineInput[]): LineInput[] {
    const merged = new Map<string, LineInput>();

    for (const line of lines) {
      // Include notes in key: same variant+modifiers with different notes = distinct lines
      const key = [
        line.variantId,
        [...(line.modifierOptionIds ?? [])].sort().join(','),
        line.notes ?? '',
      ].join('|');

      const existing = merged.get(key);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        merged.set(key, { ...line });
      }
    }

    return [...merged.values()];
  }
}
