import { Injectable, Inject, ConflictException, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import { normalizeUnit, validateCompatibleUnits } from './unit-conversion.util';
import type { Prisma } from '@prisma/client';

export interface DeductionLine {
  variantId: string;
  quantity: number;
}

export interface DeductionResult {
  movements: Array<{
    id: string;
    inventoryItemId: string;
    batchId: string;
    quantity: string;
    unit: string;
  }>;
  totalLines: number;
}

@Injectable()
export class InventoryDeductionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  /**
   * Deduct inventory synchronously within a transaction.
   * Called from payment approval inside the same $transaction.
   *
   * - Loads active recipe for each variant
   * - Locks batches in deterministic FIFO order (id ASC)
   * - Deducts using expired-batch exclusion
   * - Appends DEDUCT movements with idempotency key
   * - Updates batch remaining quantities
   * - Writes audit log
   *
   * @param tx - The active Prisma transaction client
   * @param params - Tenant, branch, order details, and lines to deduct
   */
  async deductForOrder(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      orderId: string;
      lines: DeductionLine[];
      actorUserId: string;
    },
  ): Promise<DeductionResult> {
    const { tenantId, branchId, orderId, lines, actorUserId } = params;

    const state = await this.featureResolver.resolve(tenantId, FeatureKey.INVENTORY, branchId);
    if (!state.effective) {
      return { movements: [], totalLines: 0 };
    }

    const idempotencyKey = `deduct:${orderId}`;
    const existing = await tx.inventoryMovement.findMany({
      where: {
        tenantId,
        branchId,
        idempotencyKey,
        movementType: 'DEDUCT',
      },
    });
    if (existing.length > 0) {
      return {
        movements: existing.map((m) => ({
          id: m.id,
          inventoryItemId: m.inventoryItemId,
          batchId: m.batchId!,
          quantity: m.quantity.toString(),
          unit: m.unit,
        })),
        totalLines: existing.length,
      };
    }

    const allMovements: DeductionResult['movements'] = [];
    const allConsumedBatchIds: string[] = [];

    for (const line of lines) {
      const recipe = await tx.recipe.findFirst({
        where: { tenantId, branchId, menuItemVariantId: line.variantId, isActive: true },
        include: { components: true },
      });

      if (!recipe) continue;

      for (const component of recipe.components) {
        const totalNeeded = Number(component.quantity) * line.quantity;

        const eligibleBatches = await tx.inventoryBatch.findMany({
          where: {
            tenantId,
            branchId,
            inventoryItemId: component.inventoryItemId,
            remainingQuantity: { gt: 0 },
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        });

        if (eligibleBatches.length === 0) {
          throw new ConflictException(
            `Insufficient stock for inventory item ${component.inventoryItemId}: no eligible batches`,
          );
        }

        let remaining = totalNeeded;

        for (const batch of eligibleBatches) {
          if (remaining <= 0) break;

          const batchAvailable = Number(batch.remainingQuantity);
          const toDeduct = Math.min(remaining, batchAvailable);

          if (batch.portionCount && batch.remainingPortions) {
            const portionRatio = toDeduct / batchAvailable;
            const portionsToDeduct = Math.ceil(batch.remainingPortions * portionRatio);

            await tx.$executeRaw`
              UPDATE "InventoryBatch"
              SET "remainingQuantity" = "remainingQuantity" - ${toDeduct},
                  "remainingPortions" = GREATEST("remainingPortions" - ${portionsToDeduct}, 0),
                  "updatedAt" = NOW()
              WHERE "id" = ${batch.id}
                AND "remainingQuantity" >= ${toDeduct}
            `;
          } else {
            await tx.$executeRaw`
              UPDATE "InventoryBatch"
              SET "remainingQuantity" = "remainingQuantity" - ${toDeduct},
                  "updatedAt" = NOW()
              WHERE "id" = ${batch.id}
                AND "remainingQuantity" >= ${toDeduct}
            `;
          }

          const updatedBatch = await tx.inventoryBatch.findUnique({ where: { id: batch.id } });
          if (!updatedBatch || Number(updatedBatch.remainingQuantity) < 0) {
            throw new ConflictException(
              `Insufficient stock on batch ${batch.batchCode}: concurrent deduction detected`,
            );
          }

          const movementIdempotencyKey = `deduct:${orderId}:${batch.id}:${component.inventoryItemId}:${line.variantId}`;

          const movement = await tx.inventoryMovement.create({
            data: {
              tenantId,
              branchId,
              inventoryItemId: component.inventoryItemId,
              batchId: batch.id,
              movementType: 'DEDUCT',
              quantity: toDeduct,
              unit: normalizeUnit(component.unit),
              orderId,
              reason: `Order ${orderId} deduction`,
              actorUserId,
              idempotencyKey: movementIdempotencyKey,
            },
          });

          allConsumedBatchIds.push(batch.id);
          remaining -= toDeduct;

          allMovements.push({
            id: movement.id,
            inventoryItemId: component.inventoryItemId,
            batchId: batch.id,
            quantity: toDeduct.toString(),
            unit: normalizeUnit(component.unit),
          });
        }

        if (remaining > 0.000001) {
          throw new ConflictException(
            `Insufficient stock for inventory item ${component.inventoryItemId}: need ${remaining} more ${component.unit}`,
          );
        }
      }
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        tenantId,
        branchId,
        action: 'INVENTORY_DEDUCT',
        entityType: 'InventoryMovement',
        entityId: orderId,
        afterJson: {
          orderId,
          movementCount: allMovements.length,
          consumedBatchIds: allConsumedBatchIds,
        },
      },
    });

    return { movements: allMovements, totalLines: allMovements.length };
  }

  /**
   * Restore inventory when an order is voided.
   * References the original deduction movements to restore exact consumed batches.
   *
   * @param tx - The active Prisma transaction client
   */
  async restoreForVoid(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      orderId: string;
      actorUserId: string;
    },
  ): Promise<DeductionResult> {
    const { tenantId, branchId, orderId, actorUserId } = params;

    const state = await this.featureResolver.resolve(tenantId, FeatureKey.INVENTORY, branchId);
    if (!state.effective) {
      return { movements: [], totalLines: 0 };
    }

    const restoreKey = `restore:${orderId}`;
    const existingRestores = await tx.inventoryMovement.findMany({
      where: {
        tenantId,
        branchId,
        idempotencyKey: restoreKey,
        movementType: 'VOID_RESTORE',
      },
    });
    if (existingRestores.length > 0) {
      return {
        movements: existingRestores.map((m) => ({
          id: m.id,
          inventoryItemId: m.inventoryItemId,
          batchId: m.batchId!,
          quantity: m.quantity.toString(),
          unit: m.unit,
        })),
        totalLines: existingRestores.length,
      };
    }

    const originalDeductions = await tx.inventoryMovement.findMany({
      where: {
        tenantId,
        branchId,
        orderId,
        movementType: 'DEDUCT',
      },
    });

    if (originalDeductions.length === 0) {
      return { movements: [], totalLines: 0 };
    }

    const restoreMovements: DeductionResult['movements'] = [];

    for (const deduction of originalDeductions) {
      const restoreQuantity = Number(deduction.quantity);

      await tx.$executeRaw`
        UPDATE "InventoryBatch"
        SET "remainingQuantity" = "remainingQuantity" + ${restoreQuantity},
            "updatedAt" = NOW()
        WHERE "id" = ${deduction.batchId}
      `;

      if (deduction.batchId) {
        const batch = await tx.inventoryBatch.findUnique({ where: { id: deduction.batchId } });
        if (batch?.portionCount) {
          const portionRatio = restoreQuantity / Number(batch.receivedQuantity);
          const portionsToRestore = Math.ceil((batch.portionCount) * portionRatio);
          await tx.$executeRaw`
            UPDATE "InventoryBatch"
            SET "remainingPortions" = LEAST("remainingPortions" + ${portionsToRestore}, "portionCount"),
                "updatedAt" = NOW()
            WHERE "id" = ${deduction.batchId}
              AND "portionCount" IS NOT NULL
          `;
        }
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          tenantId,
          branchId,
          inventoryItemId: deduction.inventoryItemId,
          batchId: deduction.batchId,
          movementType: 'VOID_RESTORE',
          quantity: restoreQuantity,
          unit: deduction.unit,
          orderId,
          reason: `Void restoration for order ${orderId}`,
          actorUserId,
          idempotencyKey: `restore:${orderId}:${deduction.id}`,
        },
      });

      restoreMovements.push({
        id: movement.id,
        inventoryItemId: deduction.inventoryItemId,
        batchId: deduction.batchId!,
        quantity: restoreQuantity.toString(),
        unit: deduction.unit,
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        tenantId,
        branchId,
        action: 'INVENTORY_VOID_RESTORE',
        entityType: 'InventoryMovement',
        entityId: orderId,
        afterJson: {
          orderId,
          restoreCount: restoreMovements.length,
          originalDeductionCount: originalDeductions.length,
        },
      },
    });

    return { movements: restoreMovements, totalLines: restoreMovements.length };
  }

  /**
   * Record a stock adjustment (positive or negative).
   * Idempotent via idempotency_key.
   */
  async recordAdjustment(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      inventoryItemId: string;
      quantity: number;
      unit: string;
      reason: string;
      batchId?: string;
      idempotencyKey?: string;
      actorUserId: string;
    },
  ) {
    const { tenantId, branchId, inventoryItemId, quantity, unit, reason, batchId, idempotencyKey, actorUserId } = params;

    if (quantity === 0) {
      throw new BadRequestException('Adjustment quantity cannot be zero');
    }

    const item = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId, branchId },
    });
    if (!item) throw new BadRequestException('Inventory item not found');

    validateCompatibleUnits(unit, item.baseUnit);

    if (idempotencyKey) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { tenantId_branchId_idempotencyKey: { tenantId, branchId, idempotencyKey } },
      });
      if (existing) {
        return { movement: existing, idempotent: true };
      }
    }

    if (batchId && quantity < 0) {
      const batch = await tx.inventoryBatch.findFirst({
        where: { id: batchId, tenantId, branchId, inventoryItemId },
      });
      if (!batch) throw new BadRequestException('Batch not found');

      const newRemaining = Number(batch.remainingQuantity) + quantity;
      if (newRemaining < 0) {
        throw new ConflictException('Adjustment would result in negative batch balance');
      }

      await tx.$executeRaw`
        UPDATE "InventoryBatch"
        SET "remainingQuantity" = "remainingQuantity" + ${quantity},
            "updatedAt" = NOW()
        WHERE "id" = ${batchId}
          AND "remainingQuantity" >= ${-quantity}
      `;
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId,
        branchId,
        inventoryItemId,
        batchId: batchId ?? null,
        movementType: 'ADJUST',
        quantity,
        unit: normalizeUnit(unit),
        reason,
        actorUserId,
        idempotencyKey: idempotencyKey ?? `adjust:${inventoryItemId}:${Date.now()}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        tenantId,
        branchId,
        action: 'INVENTORY_ADJUST',
        entityType: 'InventoryMovement',
        entityId: movement.id,
        afterJson: {
          inventoryItemId,
          quantity,
          unit: normalizeUnit(unit),
          reason,
          batchId: batchId ?? null,
        },
      },
    });

    return { movement, idempotent: false };
  }

  /**
   * Public wrapper: record adjustment within its own transaction.
   */
  async adjustWithTransaction(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
    quantity: number;
    unit: string;
    reason: string;
    batchId?: string;
    idempotencyKey?: string;
    actorUserId: string;
  }) {
    return this.prisma.$transaction(async (tx) => this.recordAdjustment(tx, params));
  }

  /**
   * Public wrapper: record waste within its own transaction.
   */
  async wasteWithTransaction(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
    quantity: number;
    unit: string;
    reason: string;
    batchId?: string;
    idempotencyKey?: string;
    actorUserId: string;
  }) {
    return this.prisma.$transaction(async (tx) => this.recordWaste(tx, params));
  }

  /**
   * Record waste (positive quantity only).
   * Idempotent via idempotency_key.
   */
  async recordWaste(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      inventoryItemId: string;
      quantity: number;
      unit: string;
      reason: string;
      batchId?: string;
      idempotencyKey?: string;
      actorUserId: string;
    },
  ) {
    const { tenantId, branchId, inventoryItemId, quantity, unit, reason, batchId, idempotencyKey, actorUserId } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Waste quantity must be positive');
    }

    const item = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId, branchId },
    });
    if (!item) throw new BadRequestException('Inventory item not found');

    validateCompatibleUnits(unit, item.baseUnit);

    if (idempotencyKey) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { tenantId_branchId_idempotencyKey: { tenantId, branchId, idempotencyKey } },
      });
      if (existing) {
        return { movement: existing, idempotent: true };
      }
    }

    if (batchId) {
      const batch = await tx.inventoryBatch.findFirst({
        where: { id: batchId, tenantId, branchId, inventoryItemId },
      });
      if (!batch) throw new BadRequestException('Batch not found');

      const newRemaining = Number(batch.remainingQuantity) - quantity;
      if (newRemaining < 0) {
        throw new ConflictException('Waste would result in negative batch balance');
      }

      await tx.$executeRaw`
        UPDATE "InventoryBatch"
        SET "remainingQuantity" = "remainingQuantity" - ${quantity},
            "updatedAt" = NOW()
        WHERE "id" = ${batchId}
          AND "remainingQuantity" >= ${quantity}
      `;
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId,
        branchId,
        inventoryItemId,
        batchId: batchId ?? null,
        movementType: 'WASTE',
        quantity,
        unit: normalizeUnit(unit),
        reason,
        actorUserId,
        idempotencyKey: idempotencyKey ?? `waste:${inventoryItemId}:${Date.now()}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        tenantId,
        branchId,
        action: 'INVENTORY_WASTE',
        entityType: 'InventoryMovement',
        entityId: movement.id,
        afterJson: {
          inventoryItemId,
          quantity,
          unit: normalizeUnit(unit),
          reason,
          batchId: batchId ?? null,
        },
      },
    });

    return { movement, idempotent: false };
  }
}
