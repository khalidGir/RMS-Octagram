import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import { normalizeUnit, validateCompatibleUnits } from './unit-conversion.util';

@Injectable()
export class InventoryBatchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async receiveBatch(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
    batchCode: string;
    receivedQuantity: number;
    unit: string;
    portionCount?: number;
    costMinor?: number;
    expiresAt?: string;
    idempotencyKey?: string;
    actorUserId: string;
  }) {
    const {
      tenantId, branchId, inventoryItemId, batchCode, receivedQuantity,
      unit, portionCount, costMinor, expiresAt, idempotencyKey, actorUserId,
    } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.BATCH_INVENTORY, branchId);

    if (receivedQuantity <= 0) {
      throw new BadRequestException('receivedQuantity must be positive');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId, branchId, isActive: true },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    validateCompatibleUnits(unit, item.baseUnit);

    const normalizedUnit = normalizeUnit(unit);

    const result = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.inventoryMovement.findUnique({
          where: { tenantId_branchId_idempotencyKey: { tenantId, branchId, idempotencyKey } },
        });
        if (existing) {
          const batch = await tx.inventoryBatch.findUnique({ where: { id: existing.batchId! } });
          return { movement: existing, batch, idempotent: true };
        }
      }

      const batch = await tx.inventoryBatch.create({
        data: {
          tenantId,
          branchId,
          inventoryItemId,
          batchCode,
          receivedQuantity: receivedQuantity,
          remainingQuantity: receivedQuantity,
          unit: normalizedUnit,
          portionCount: portionCount ?? null,
          remainingPortions: portionCount ?? null,
          costMinor: costMinor ? BigInt(costMinor) : null,
          receivedAt: new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          tenantId,
          branchId,
          inventoryItemId,
          batchId: batch.id,
          movementType: 'RECEIVE',
          quantity: receivedQuantity,
          unit: normalizedUnit,
          reason: `Batch received: ${batchCode}`,
          actorUserId,
          idempotencyKey: idempotencyKey ?? `receive:${batch.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'INVENTORY_BATCH_RECEIVE',
          entityType: 'InventoryBatch',
          entityId: batch.id,
          afterJson: {
            inventoryItemId,
            batchCode,
            receivedQuantity,
            unit: normalizedUnit,
            portionCount: portionCount ?? null,
            costMinor: costMinor?.toString() ?? null,
          },
        },
      });

      return { movement, batch, idempotent: false };
    });

    return {
      movement: this.serializeMovement(result.movement),
      batch: this.serializeBatch(result.batch!),
      idempotent: result.idempotent,
    };
  }

  async listBatches(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
  }) {
    const { tenantId, branchId, inventoryItemId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.BATCH_INVENTORY, branchId);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: { tenantId, branchId, inventoryItemId },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });

    return { batches: batches.map((b) => this.serializeBatch(b)) };
  }

  private serializeBatch(batch: Record<string, unknown>) {
    const b = batch as any;
    return {
      id: b.id,
      tenantId: b.tenantId,
      branchId: b.branchId,
      inventoryItemId: b.inventoryItemId,
      batchCode: b.batchCode,
      receivedQuantity: b.receivedQuantity?.toString?.() ?? b.receivedQuantity,
      remainingQuantity: b.remainingQuantity?.toString?.() ?? b.remainingQuantity,
      unit: b.unit,
      portionCount: b.portionCount,
      remainingPortions: b.remainingPortions,
      costMinor: b.costMinor?.toString?.() ?? b.costMinor,
      receivedAt: b.receivedAt,
      expiresAt: b.expiresAt,
      createdAt: b.createdAt,
    };
  }

  private serializeMovement(movement: Record<string, unknown>) {
    const m = movement as any;
    return {
      id: m.id,
      tenantId: m.tenantId,
      branchId: m.branchId,
      inventoryItemId: m.inventoryItemId,
      batchId: m.batchId,
      movementType: m.movementType,
      quantity: m.quantity?.toString?.() ?? m.quantity,
      unit: m.unit,
      orderId: m.orderId,
      reason: m.reason,
      actorUserId: m.actorUserId,
      idempotencyKey: m.idempotencyKey,
      createdAt: m.createdAt,
    };
  }
}
