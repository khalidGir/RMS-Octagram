import { Injectable, Inject } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';

@Injectable()
export class InventoryMovementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async listMovements(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
    movementType?: string;
    from?: string;
    to?: string;
    limit?: number;
    after?: string;
  }) {
    const { tenantId, branchId, inventoryItemId, movementType, from, to, limit = 50, after } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const where: Record<string, unknown> = {
      tenantId,
      branchId,
      inventoryItemId,
    };

    if (movementType) where.movementType = movementType;

    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, Date>).gte = new Date(from);
      if (to) (where.createdAt as Record<string, Date>).lte = new Date(to);
    }

    const movements = await this.prisma.inventoryMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    let nextCursor: string | undefined;
    if (movements.length > limit) {
      const last = movements.pop()!;
      nextCursor = last.id;
    }

    return {
      movements: movements.map((m) => this.serializeMovement(m)),
      nextCursor,
    };
  }

  async getMovementAggregate(params: {
    tenantId: string;
    branchId: string;
    inventoryItemId: string;
  }) {
    const { tenantId, branchId, inventoryItemId } = params;

    await this.featureResolver.assertEffective(tenantId, FeatureKey.INVENTORY, branchId);

    const movements = await this.prisma.inventoryMovement.findMany({
      where: { tenantId, branchId, inventoryItemId },
      select: { movementType: true, quantity: true },
    });

    const aggregate: Record<string, number> = {};
    for (const m of movements) {
      const qty = Number(m.quantity);
      aggregate[m.movementType] = (aggregate[m.movementType] ?? 0) + qty;
    }

    const received = aggregate['RECEIVE'] ?? 0;
    const deducted = aggregate['DEDUCT'] ?? 0;
    const adjusted = aggregate['ADJUST'] ?? 0;
    const voidRestored = aggregate['VOID_RESTORE'] ?? 0;
    const wasted = aggregate['WASTE'] ?? 0;

    const totalStock = received - deducted + adjusted + voidRestored - wasted;

    return {
      received,
      deducted,
      adjusted,
      voidRestored,
      wasted,
      totalStock,
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
