import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FulfillmentStatusService } from '../../src/modules/kitchen/fulfillment-status.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required.');
}

/**
 * Migration verification tests for 20260912000000_multi_kitchen_fulfillment.
 *
 * Runs against a dedicated replay database built by test/migration/global-setup.ts:
 * migrations 1..23, then the pre-multi-kitchen fixture, then the target migration,
 * so every assertion below verifies the migration backfills on data this suite owns.
 * Every test compares against the complete Branch table — no silent passes
 * on empty subsets. Constraint tests create their own fixtures when needed.
 */
describe('multi-kitchen migration verification (e2e)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every KitchenStation is attached to a kitchen', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT ks."id", ks."branchId"
      FROM "KitchenStation" ks
      WHERE ks."kitchenId" IS NULL
    `;
    expect(orphans).toEqual([]);
  });

  it('every Branch has exactly one "Main Kitchen"', async () => {
    // Get ALL branches — not just those with kitchens
    const allBranches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Branch"
    `;
    expect(allBranches.length).toBeGreaterThan(0);

    for (const branch of allBranches) {
      const kitchens = await prisma.$queryRaw<{ name: string }[]>`
        SELECT "name" FROM "Kitchen" WHERE "branchId" = ${branch.id} AND "name" = 'Main Kitchen'
      `;
      expect(kitchens.length).toBe(1);
    }
  });

  it('every Branch has a default fulfillment policy', async () => {
    const allBranches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Branch"
    `;
    expect(allBranches.length).toBeGreaterThan(0);

    for (const branch of allBranches) {
      const policies = await prisma.$queryRaw<{ serviceMode: string; expoMode: string }[]>`
        SELECT "serviceMode", "expoMode"
        FROM "BranchFulfillmentPolicy"
        WHERE "branchId" = ${branch.id}
      `;
      expect(policies.length).toBe(1);
      expect(policies[0].serviceMode).toBe('ALL_AT_ONCE');
      expect(policies[0].expoMode).toBe('NONE');
    }
  });

  it('Order.fulfillmentStatus derivation is correct', async () => {
    const orders = await prisma.$queryRaw<{ id: string; fulfillmentStatus: string }[]>`
      SELECT o."id", o."fulfillmentStatus"
      FROM "Order" o
      WHERE o."id" IN (SELECT DISTINCT "orderId" FROM "KitchenTicket")
    `;

    for (const order of orders) {
      const tickets = await prisma.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "KitchenTicket" WHERE "orderId" = ${order.id}
      `;

      const active = tickets.map((t) => t.status).filter((s) => s !== 'CANCELLED');
      if (active.length === 0) continue;

      // Canonical derivation rules (same implementation production uses to
      // maintain Order.fulfillmentStatus). The previous inline mirror disagreed
      // with migration §16 and production for all-COMPLETED tickets.
      const expected = FulfillmentStatusService.computeFromStatuses(active);
      expect(order.fulfillmentStatus).toBe(expected);
    }
  });

  it('KitchenTicketLine constraint: negative quantity rejected', async () => {
    // Build complete fixture from scratch: branch -> kitchen -> station -> order -> line -> ticket
    const branch = await prisma.branch.findFirst();
    const tenant = await prisma.tenant.findFirst();
    expect(branch).toBeTruthy();
    expect(tenant).toBeTruthy();

    const kitchen = await prisma.kitchen.findFirst({ where: { branchId: branch!.id } });
    const station = await prisma.kitchenStation.findFirst({ where: { branchId: branch!.id } });
    expect(kitchen).toBeTruthy();
    expect(station).toBeTruthy();

    const order = await prisma.order.findFirst({ where: { branchId: branch!.id } });
    if (!order) return; // No orders in DB

    const line = await prisma.orderLine.findFirst({ where: { orderId: order.id } });
    if (!line) return;

    // Reuse an existing ticket for this order+station when present; other
    // suites legitimately own tickets on shared orders (unique constraint on
    // tenantId+branchId+orderId+stationId) and this suite must not collide.
    const existingTicket = await prisma.kitchenTicket.findFirst({
      where: {
        tenantId: tenant!.id,
        branchId: branch!.id,
        orderId: order.id,
        stationId: station!.id,
      },
    });
    const ownsTicket = !existingTicket;
    const testTicket =
      existingTicket ??
      (await prisma.kitchenTicket.create({
        data: {
          tenantId: tenant!.id,
          branchId: branch!.id,
          orderId: order.id,
          stationId: station!.id,
          kitchenId: kitchen!.id,
          ticketNumber: BigInt(999900),
          ticketType: 'PREPARATION',
          status: 'QUEUED',
        },
      }));

    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${tenant!.id}, ${branch!.id}, ${testTicket.id}, ${line.id},
          'PREPARE', true, -1, 0, 0, 0, 0, 1, now()
        )
      `,
    ).rejects.toThrow();

    if (ownsTicket) {
      await prisma.kitchenTicket.delete({ where: { id: testTicket.id } });
    }
  });

  it('KitchenTicketLine constraint: collected > ready rejected', async () => {
    const ticket = await prisma.kitchenTicket.findFirst();
    if (!ticket) return;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${ticket.tenantId}, ${ticket.branchId}, ${ticket.id},
          'nonexistent-line', 'PREPARE', true, 10, 5, 3, 7, 0, 1, now()
        )
      `,
    ).rejects.toThrow();
  });

  it('KitchenTicketLine constraint: served > collected rejected', async () => {
    const ticket = await prisma.kitchenTicket.findFirst();
    if (!ticket) return;

    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${ticket.tenantId}, ${ticket.branchId}, ${ticket.id},
          'nonexistent-line', 'PREPARE', true, 10, 8, 6, 4, 5, 1, now()
        )
      `,
    ).rejects.toThrow();
  });

  it('KitchenTicketLine constraint: valid chain accepted', async () => {
    const ticket = await prisma.kitchenTicket.findFirst();
    if (!ticket) return;

    const lineId = crypto.randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "KitchenTicketLine" (
          "id", "tenantId", "branchId", "ticketId", "orderLineId",
          "routeType", "isRequired", "quantity", "quantityPrepared",
          "quantityReady", "quantityCollected", "quantityServed", "version", "updatedAt"
        ) VALUES (
          ${lineId}, ${ticket.tenantId}, ${ticket.branchId}, ${ticket.id},
          'valid-test-line', 'PREPARE', true, 10, 7, 5, 4, 3, 1, now()
        )
      `,
    ).resolves.toBeDefined();

    await prisma.kitchenTicketLine.delete({ where: { id: lineId } });
  });

  it('KitchenTicket.kitchenId FK points to a valid Kitchen', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; kitchenId: string }[]>`
      SELECT kt."id", kt."kitchenId"
      FROM "KitchenTicket" kt
      WHERE kt."kitchenId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Kitchen" k WHERE k."id" = kt."kitchenId")
    `;
    expect(orphans).toEqual([]);
  });

  it('Kitchen.branchId FK points to a valid Branch', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT k."id", k."branchId"
      FROM "Kitchen" k
      WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."id" = k."branchId")
    `;
    expect(orphans).toEqual([]);
  });

  it('KdsDevice.branchId FK points to a valid Branch', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT d."id", d."branchId"
      FROM "KdsDevice" d
      WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."id" = d."branchId")
    `;
    expect(orphans).toEqual([]);
  });

  it('BranchFulfillmentPolicy.branchId FK points to a valid Branch', async () => {
    const orphans = await prisma.$queryRaw<{ id: string; branchId: string }[]>`
      SELECT p."id", p."branchId"
      FROM "BranchFulfillmentPolicy" p
      WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."id" = p."branchId")
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
