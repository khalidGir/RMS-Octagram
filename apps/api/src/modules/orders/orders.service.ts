import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ConflictException,
  NotImplementedException,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BranchOrderCounterService } from './branch-order-counter.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { IdempotencyService } from './idempotency.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PriceCalculatorService } from './price-calculator.service';
import type { LineInput } from './price-calculator.service';
import { canTransition3A, canTransitionFull, getInitialStatus } from './state-machine';
import * as crypto from 'crypto';
import { FeatureKey } from '@rms/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryDeductionService } from '../inventory/inventory-deduction.service';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchOrderCounterService) private readonly counter: BranchOrderCounterService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PriceCalculatorService) private readonly priceCalc: PriceCalculatorService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(InventoryDeductionService) private readonly deductionService: InventoryDeductionService,
  ) {}

  // ─── CREATE PICKUP ORDER (Public) ──────────

  async createPickupOrder(params: {
    tenantId: string;
    branchId: string;
    customerName: string;
    customerPhone: string;
    pickupAt: string;
    lines: LineInput[];
    notes?: string;
    idempotencyKey?: string;
    quotedTotal?: string;
  }): Promise<{ order: Record<string, unknown>; trackingTokenRaw: string }> {
    const { tenantId, branchId, idempotencyKey } = params;

    await this.assertBranchActive(tenantId, branchId);
    await this.featureResolver.assertEffective(tenantId, FeatureKey.PICKUP_ORDERING, branchId);

    const pickupDate = new Date(params.pickupAt);
    if (Number.isNaN(pickupDate.getTime())) {
      throw new ConflictException('pickupAt must be a valid ISO 8601 date');
    }
    if (pickupDate <= new Date()) {
      throw new ConflictException('pickupAt must be in the future');
    }

    const minLeadMinutes = await this.getPickupLeadMinutes(tenantId, branchId);
    const earliestAllowed = new Date(Date.now() + minLeadMinutes * 60_000);
    if (pickupDate < earliestAllowed) {
      throw new ConflictException(
        `Pickup time must be at least ${minLeadMinutes} minutes from now`,
      );
    }

    if (await this.isOutsidePickupHours(tenantId, branchId, pickupDate)) {
      throw new ConflictException('Pickup time is outside branch pickup hours');
    }

    const lines = this.deduplicateLines(params.lines);
    const calculation = await this.priceCalc.calculateCart(tenantId, branchId, lines);

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

    const paymentPolicy = await this.getPaymentPolicy(tenantId, branchId);
    const initialStatus = getInitialStatus(paymentPolicy);
    const { raw: trackingTokenRaw, hash: trackingTokenHash } = this.generateTrackingToken();

    const execute = async () => {
      const order = await this.prisma.$transaction(async (tx) => {
        const orderNumber = await this.counter.nextOrderNumber(tx, branchId);

        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            orderNumber,
            orderType: 'PICKUP',
            status: initialStatus,
            customerName: params.customerName,
            customerPhone: params.customerPhone,
            pickupAt: pickupDate,
            currency: 'ETB',
            subtotalMinor: calculation.subtotalMinor,
            discountMinor: 0n,
            taxMinor: calculation.vatMinor,
            serviceChargeMinor: calculation.serviceChargeMinor,
            totalMinor: calculation.totalMinor,
            taxConfigVersionId: calculation.taxConfigVersionId,
            vatRateSnapshot: calculation.vatRateBps > 0 ? (calculation.vatRateBps / 10000).toString() : null,
            roundingModeSnapshot: calculation.roundingMode,
            notes: params.notes ?? null,
            source: 'CUSTOMER_WEB',
            trackingTokenHash,
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
            actorUserId: null,
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
              totalMinor: calculation.totalMinor.toString(),
              orderType: 'PICKUP',
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: null,
            tenantId,
            branchId,
            action: 'ORDER_CREATE_PICKUP',
            entityType: 'Order',
            entityId: order.id,
            afterJson: {
              orderNumber: orderNumber.toString(),
              status: initialStatus,
              totalMinor: calculation.totalMinor.toString(),
              lineCount: calculation.lines.length,
              source: 'CUSTOMER_WEB',
              customerName: params.customerName,
              customerPhone: params.customerPhone,
              pickupAt: pickupDate.toISOString(),
            },
          },
        });

        return order;
      });

      const orderWithLines = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { lines: { include: { modifiers: true } } },
      });

      return {
        status: 201 as const,
        body: { ...this.serializeOrder(orderWithLines!), trackingToken: trackingTokenRaw },
        resourceId: order.id,
      };
    };

    if (idempotencyKey) {
      const { result } = await this.idempotency.withIdempotency(
        {
          tenantId,
          branchId,
          operation: 'createPickupOrder',
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

  // ─── CREATE TABLE ORDER (Public) ─────────────

  async createTableOrder(params: {
    tenantId: string;
    branchId: string;
    tableId?: string;
    diningSessionId?: string;
    orderType?: string;
    lines: LineInput[];
    notes?: string;
    customerName?: string;
    customerPhone?: string;
    idempotencyKey?: string;
    quotedTotal?: string;
  }): Promise<{ order: Record<string, unknown>; trackingTokenRaw: string }> {
    const { tenantId, branchId, idempotencyKey } = params;

    // Determine order type — default DINE_IN for QR context
    const orderType = params.orderType === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN';
    const isDineIn = orderType === 'DINE_IN';

    // DINE_IN requires a table
    const tableId = isDineIn ? (params.tableId ?? '') : null;
    const diningSessionId = isDineIn ? (params.diningSessionId ?? undefined) : undefined;

    // Verify branch is active
    await this.assertBranchActive(tenantId, branchId);

    // Verify TABLE_QR_ORDERING feature is enabled
    await this.featureResolver.assertEffective(tenantId, FeatureKey.TABLE_QR_ORDERING, branchId);

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
            orderType,
            status: initialStatus,
            diningSessionId: diningSessionId ?? null,
            tableId: tableId ?? null,
            customerName: params.customerName ?? null,
            customerPhone: params.customerPhone ?? null,
            currency: 'ETB',
            subtotalMinor: calculation.subtotalMinor,
            discountMinor: 0n,
            taxMinor: calculation.vatMinor,
            serviceChargeMinor: calculation.serviceChargeMinor,
            totalMinor: calculation.totalMinor,
            taxConfigVersionId: calculation.taxConfigVersionId,
            vatRateSnapshot: calculation.vatRateBps > 0 ? (calculation.vatRateBps / 10000).toString() : null,
            roundingModeSnapshot: calculation.roundingMode,
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
              totalMinor: calculation.totalMinor.toString(),
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
              totalMinor: calculation.totalMinor.toString(),
              lineCount: calculation.lines.length,
              source: 'CUSTOMER_WEB',
            },
          },
        });

        return order;
      });

      const orderWithLines = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { lines: { include: { modifiers: true } } },
      });

      return {
        status: 201 as const,
        body: { ...this.serializeOrder(orderWithLines!), trackingToken: trackingTokenRaw },
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

    // Validate orderType
    const validOrderTypes = ['POS', 'DINE_IN', 'PICKUP', 'TAKEAWAY'];
    if (!validOrderTypes.includes(params.orderType)) {
      throw new BadRequestException(`Invalid orderType: ${params.orderType}. Must be one of: ${validOrderTypes.join(', ')}`);
    }

    // Reject tableId for POS, PICKUP, and TAKEAWAY order types
    if ((params.orderType === 'POS' || params.orderType === 'PICKUP' || params.orderType === 'TAKEAWAY') && params.tableId) {
      throw new ConflictException(`tableId is not allowed for ${params.orderType} orders`);
    }

    // DINE_IN requires tableId
    if (params.orderType === 'DINE_IN' && !params.tableId) {
      throw new ConflictException('tableId is required for DINE_IN orders');
    }

    // Feature assertions for order types
    if (params.orderType === 'PICKUP') {
      await this.featureResolver.assertEffective(tenantId, FeatureKey.PICKUP_ORDERING, branchId);
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
            taxMinor: calculation.vatMinor,
            serviceChargeMinor: calculation.serviceChargeMinor,
            totalMinor: calculation.totalMinor,
            taxConfigVersionId: calculation.taxConfigVersionId,
            vatRateSnapshot: calculation.vatRateBps > 0 ? (calculation.vatRateBps / 10000).toString() : null,
            roundingModeSnapshot: calculation.roundingMode,
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
              totalMinor: calculation.totalMinor.toString(),
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
              totalMinor: calculation.totalMinor.toString(),
              lineCount: calculation.lines.length,
              source: 'CASHIER_POS',
            },
          },
        });

        return order;
      });

      const orderWithLines = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { lines: { include: { modifiers: true } } },
      });

      return { status: 201 as const, body: this.serializeOrder(orderWithLines!), resourceId: order.id };
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
            taxMinor: calculation.vatMinor,
            serviceChargeMinor: calculation.serviceChargeMinor,
            totalMinor: calculation.totalMinor,
            taxConfigVersionId: calculation.taxConfigVersionId,
            vatRateSnapshot: calculation.vatRateBps > 0 ? (calculation.vatRateBps / 10000).toString() : null,
            roundingModeSnapshot: calculation.roundingMode,
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
              totalMinor: calculation.totalMinor.toString(),
              version: updated.version,
            },
          },
        });

        return updated;
      });

      const orderWithLines = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { lines: { include: { modifiers: true } } },
      });

      return { status: 200 as const, body: this.serializeOrder(orderWithLines!), resourceId: order.id };
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

  // ─── COMPLETE ORDER (READY → COMPLETED) ──────

  async completeOrder(params: {
    orderId: string;
    tenantId: string;
    branchId: string;
    actorUserId: string;
    expectedVersion: number;
  }): Promise<{ order: Record<string, unknown> }> {
    const { orderId, tenantId, branchId, actorUserId, expectedVersion } = params;

    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId },
    });
    if (!existing) throw new NotFoundException('Order not found');

    if (!canTransitionFull(existing.status, 'COMPLETED')) {
      throw new ConflictException(
        `Cannot complete order in status ${existing.status}. Order must be in READY status.`,
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
          status: 'COMPLETED',
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId,
          fromStatus: existing.status,
          toStatus: 'COMPLETED',
          actorUserId,
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.completed',
          payload: { orderId },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_COMPLETE',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { status: existing.status },
          afterJson: { status: 'COMPLETED' },
        },
      });

      return updated;
    });

    return { order: this.serializeOrder(order) };
  }

  // ─── VOID ORDER (with inventory restoration) ──

  async voidOrder(params: {
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

    if (!canTransition3A(existing.status, 'VOIDED') && existing.status !== 'CONFIRMED' && existing.status !== 'IN_PROGRESS' && existing.status !== 'READY' && existing.status !== 'COMPLETED') {
      if (existing.status === 'VOIDED') {
        return { order: this.serializeOrder(existing) };
      }
      throw new ConflictException(
        `Cannot void order in status ${existing.status}`,
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
          status: 'VOIDED',
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
          toStatus: 'VOIDED',
          actorUserId,
          reason,
        },
      });

      // Restore inventory for confirmed orders
      if (['CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED'].includes(existing.status)) {
        await this.deductionService.restoreForVoid(tx, {
          tenantId,
          branchId,
          orderId,
          actorUserId,
        });
      }

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: orderId,
          eventType: 'order.voided',
          payload: { orderId, reason, previousStatus: existing.status },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'ORDER_VOID',
          entityType: 'Order',
          entityId: orderId,
          beforeJson: { status: existing.status },
          afterJson: { status: 'VOIDED', reason },
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

  private async getPickupLeadMinutes(tenantId: string, branchId: string): Promise<number> {
    const branchSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId, featureKey: 'PICKUP_ORDERING' },
    });
    if (branchSetting?.configuration && typeof (branchSetting.configuration as any).leadMinutes === 'number') {
      return (branchSetting.configuration as any).leadMinutes;
    }

    const tenantSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId: null, featureKey: 'PICKUP_ORDERING' },
    });
    if (tenantSetting?.configuration && typeof (tenantSetting.configuration as any).leadMinutes === 'number') {
      return (tenantSetting.configuration as any).leadMinutes;
    }

    return 15;
  }

  private async isOutsidePickupHours(tenantId: string, branchId: string, pickupDate: Date): Promise<boolean> {
    const branchSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId, featureKey: 'PICKUP_ORDERING' },
    });
    const config = branchSetting?.configuration as any;
    if (!config?.pickupOpen || !config?.pickupClose) return false;

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { timezone: true },
    });
    const tz = branch?.timezone || 'Africa/Addis_Ababa';
    const localTime = (() => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(pickupDate);
      const h = parts.find((p) => p.type === 'hour')?.value ?? '0';
      const m = parts.find((p) => p.type === 'minute')?.value ?? '0';
      return `${h}:${m}`;
    })();

    const open = config.pickupOpen as string;
    const close = config.pickupClose as string;
    if (open <= close) {
      return localTime < open || localTime > close;
    }
    return localTime < open && localTime > close;
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
