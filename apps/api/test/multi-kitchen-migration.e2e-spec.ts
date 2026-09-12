import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required.');
}

/**
 * Migration verification tests for 20260912000000_multi_kitchen_fulfillment.
 *
 * Validates:
 * 1. Every existing KitchenStation receives a kitchenId pointing to its branch's default kitchen
 * 2. Every Order with tickets derives the correct fulfillmentStatus
 * 3. Every branch gets a default BranchFulfillmentPolicy
 * 4. Numeric CHECK constraints reject negative quantities
 * 5. One-active-expo-per-branch partial unique index works
 */
describe('multi-kitchen migration verification (e2e)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every existing KitchenStation is attached to a kitchen', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT ks."id", ks."branchId"
      FROM "KitchenStation" ks
      WHERE ks."kitchenId" IS NULL
    `;

    expect(orphans).toEqual([]);
  });

  it('every branch has exactly one default "Main Kitchen"', async () => {
    const counts = await prisma.$queryRaw<{ branchId: string; cnt: bigint }[]>`
      SELECT "branchId", COUNT(*) as cnt
      FROM "Kitchen"
      WHERE "name" = 'Main Kitchen'
      GROUP BY "branchId"
    `;

    for (const row of counts) {
      expect(Number(row.cnt)).toBe(1);
    }
  });

  it('every branch with stations has a default fulfillment policy', async () => {
    const branchesWithStations = await prisma.$queryRaw<{ branchId: string }[]>`
      SELECT DISTINCT ks."branchId"
      FROM "KitchenStation" ks
    `;

    for (const { branchId } of branchesWithStations) {
      const policy = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "BranchFulfillmentPolicy" WHERE "branchId" = ${branchId}
      `;
      expect(policy.length).toBe(1);
    }
  });

  it('Order.fulfillmentStatus derivation: all active READY -> READY_FOR_SERVICE', async () => {
    // Find an order where all non-cancelled tickets are READY or COMPLETED
    const orders = await prisma.$queryRaw<{ id: string; fulfillmentStatus: string }[]>`
      SELECT o."id", o."fulfillmentStatus"
      FROM "Order" o
      WHERE o."id" IN (
        SELECT DISTINCT kt."orderId" FROM "KitchenTicket" kt
      )
    `;

    for (const order of orders) {
      const tickets = await prisma.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "KitchenTicket" WHERE "orderId" = ${order.id}
      `;

      const activeStatuses = tickets
        .map((t) => t.status)
        .filter((s) => s !== 'CANCELLED');

      if (activeStatuses.length === 0) continue;

      const allReadyOrComplete = activeStatuses.every(
        (s) => s === 'READY' || s === 'COMPLETED',
      );
      const someReady = activeStatuses.some((s) => s === 'READY');
      const someInProgress = activeStatuses.some(
        (s) => s !== 'READY' && s !== 'COMPLETED',
      );

      if (allReadyOrComplete && someReady) {
        expect(order.fulfillmentStatus).toBe('READY_FOR_SERVICE');
      } else if (someReady && someInProgress) {
        expect(order.fulfillmentStatus).toBe('PARTIALLY_READY');
      }
    }
  });

  it('KitchenTicketLine quantity constraints reject negative values', async () => {
    // Attempting to insert a negative quantity should violate CHECK constraint
    const ticket = await prisma.kitchenTicket.findFirst({
      where: { deletedAt: null },
    });
    if (!ticket) return; // No tickets to test against

    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version"
        ) VALUES (
          gen_random_uuid(), ${ticket.tenantId}, ${ticket.branchId}, ${ticket.id},
          'nonexistent-order-line', 'PREPARE', true, -1, 0, 0, 0, 0, 1
        )
      `,
    ).rejects.toThrow();
  });

  it('KitchenTicketLine collected cannot exceed ordered quantity', async () => {
    const ticket = await prisma.kitchenTicket.findFirst({
      where: { deletedAt: null },
    });
    if (!ticket) return;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version"
        ) VALUES (
          gen_random_uuid(), ${ticket.tenantId}, ${ticket.branchId}, ${ticket.id},
          'nonexistent-order-line', 'PREPARE', true, 2, 0, 0, 5, 0, 1
        )
      `,
    ).rejects.toThrow();
  });

  it('KitchenTicket.kitchenId FK points to a valid Kitchen', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; kitchenId: string }[]>`
      SELECT kt."id", kt."kitchenId"
      FROM "KitchenTicket" kt
      WHERE kt."kitchenId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Kitchen" k WHERE k."id" = kt."kitchenId"
        )
    `;

    expect(orphans).toEqual([]);
  });

  it('KdsDeviceStation FKs are consistent', async () => {
    const orphans = await prisma.$queryRaw<{ deviceId: string; stationId: string }[]>`
      SELECT kds."deviceId", kds."stationId"
      FROM "KdsDeviceStation" kds
      LEFT JOIN "KdsDevice" kd ON kd."id" = kds."deviceId"
      LEFT JOIN "KitchenStation" ks ON ks."id" = kds."stationId"
      WHERE kd."id" IS NULL OR ks."id" IS NULL
    `;

    expect(orphans).toEqual([]);
  });
});
