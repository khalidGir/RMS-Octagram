import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { ServiceNotificationService } from '../src/modules/kitchen/service-notification.service';
import { ServiceNotificationType } from '@rms/contracts';
import { KdsGateway } from '../src/modules/kitchen/kds.gateway';
import { seedEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const ts = Date.now();

async function login(app: any, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Test1234!' });
  if (!res.body?.data?.accessToken)
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

describe('Expo + Waiter Fulfillment — Integration (e2e)', () => {
  let app: any;
  let outboxProcessor: OutboxProcessor;

  let ownerToken: string;
  let managerToken: string;
  let kitchenToken: string;
  let waiterToken: string;
  let cashierToken: string;

  let tenantId: string;
  let branchId: string;
  let variantId: string;
  let grillStationId: string;
  let expoStationId: string;

  let waiterUserId: string;

  // Second branch for cross-branch tests
  let branch2Id: string;
  let waiter2Token: string;

  // Second tenant for cross-tenant tests
  let tenant2Id: string;
  let branch2Tenant2Id: string;
  let owner2Token: string;

  const ownerEmail = `ewf-owner-${ts}@test.com`;
  const managerEmail = `ewf-manager-${ts}@test.com`;
  const kitchenEmail = `ewf-kitchen-${ts}@test.com`;
  const waiterEmail = `ewf-waiter-${ts}@test.com`;
  const waiterPhone = `+2519${(ts % 100000000).toString().padStart(8, '0')}`;
  const cashierEmail = `ewf-cashier-${ts}@test.com`;
  const waiter2Email = `ewf-waiter2-${ts}@test.com`;
  const owner2Email = `ewf-owner2-${ts}@test.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    outboxProcessor = app.get(OutboxProcessor);
    await outboxProcessor.stop();

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // ─── Tenant 1 ────────────────────────────────────────────────
    const tenant = await prisma.tenant.create({
      data: { name: 'EWFTenant', slug: `ewf-t-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: `ewf-main-${ts}`, isActive: true },
    });
    branchId = branch.id;

    // Branch 2 for cross-branch tests
    const branch2 = await prisma.branch.create({
      data: { tenantId, name: 'Branch2', slug: `ewf-b2-${ts}`, isActive: true },
    });
    branch2Id = branch2.id;

    // Fulfillment policy: expo REQUIRED + waiter self-claim allowed
    await prisma.branchFulfillmentPolicy.create({
      data: {
        tenantId,
        branchId,
        serviceMode: 'ALL_AT_ONCE',
        expoMode: 'REQUIRED',
        allowWaiterSelfClaim: true,
        showUnassignedReadyOrdersToWaiters: true,
      },
    });

    // ─── Users ───────────────────────────────────────────────────
    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.createMany({
      data: [
        { tenantId, branchId, membershipId: om.id },
        { tenantId, branchId: branch2Id, membershipId: om.id },
      ],
    });

    const kitchen = await prisma.user.create({
      data: { email: kitchenEmail, passwordHash, displayName: 'Kitchen', status: 'ACTIVE' },
    });
    const km = await prisma.tenantMembership.create({
      data: { tenantId, userId: kitchen.id, role: 'KITCHEN_STAFF', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: km.id } });

    const manager = await prisma.user.create({
      data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' },
    });
    const mgm = await prisma.tenantMembership.create({
      data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.createMany({
      data: [
        { tenantId, branchId, membershipId: mgm.id },
        { tenantId, branchId: branch2Id, membershipId: mgm.id },
      ],
    });

    const waiter = await prisma.user.create({
      data: { email: waiterEmail, phoneE164: waiterPhone, passwordHash, displayName: 'Waiter', status: 'ACTIVE' },
    });
    waiterUserId = waiter.id;
    const wm = await prisma.tenantMembership.create({
      data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.createMany({
      data: [
        { tenantId, branchId, membershipId: wm.id },
        { tenantId, branchId: branch2Id, membershipId: wm.id },
      ],
    });

    const waiter2 = await prisma.user.create({
      data: { email: waiter2Email, passwordHash, displayName: 'Waiter2', status: 'ACTIVE' },
    });
    const w2m = await prisma.tenantMembership.create({
      data: { tenantId, userId: waiter2.id, role: 'WAITER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branch2Id, membershipId: w2m.id } });

    const cashier = await prisma.user.create({
      data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' },
    });
    const cm = await prisma.tenantMembership.create({
      data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });

    // ─── Tenant 2 for cross-tenant tests ────────────────────────
    const tenant2 = await prisma.tenant.create({
      data: { name: 'EWFTenant2', slug: `ewf-t2-${ts}`, status: 'ACTIVE' },
    });
    tenant2Id = tenant2.id;
    await seedEntitlements(prisma, tenant2Id);

    const branch2T2 = await prisma.branch.create({
      data: { tenantId: tenant2Id, name: 'Main', slug: `ewf-t2-main-${ts}`, isActive: true },
    });
    branch2Tenant2Id = branch2T2.id;

    const owner2 = await prisma.user.create({
      data: { email: owner2Email, passwordHash, displayName: 'Owner2', status: 'ACTIVE' },
    });
    await prisma.tenantMembership.create({
      data: { tenantId: tenant2Id, userId: owner2.id, role: 'OWNER', status: 'ACTIVE' },
    });

    // ─── Menu ────────────────────────────────────────────────────
    const category = await prisma.menuCategory.create({
      data: { tenantId, name: 'Food', sortOrder: 0, isActive: true },
    });
    const item = await prisma.menuItem.create({
      data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true },
    });
    const variant = await prisma.menuItemVariant.create({
      data: {
        tenantId,
        name: 'Regular',
        sku: `EWF-${ts}`,
        basePriceMinor: 25000n,
        isDefault: true,
        isActive: true,
        menuItem: { connect: { id: item.id } },
      },
    });
    variantId = variant.id;

    await prisma.branchMenuItem.create({
      data: { tenantId, branchId, menuItemId: item.id, isAvailable: true },
    });

    // ─── Kitchen + Stations ──────────────────────────────────────
    const kitchen1 = await prisma.kitchen.create({
      data: { tenantId, branchId, name: 'Main Kitchen', isActive: true },
    });

    grillStationId = (
      await prisma.kitchenStation.create({
        data: { tenantId, branchId, kitchenId: kitchen1.id, name: 'Grill', displayOrder: 0, isExpo: false },
      })
    ).id;

    expoStationId = (
      await prisma.kitchenStation.create({
        data: { tenantId, branchId, kitchenId: kitchen1.id, name: 'Expo', displayOrder: 1, isExpo: true },
      })
    ).id;

    // Routes: item → PREPARE on grill, ASSEMBLE on expo
    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId: grillStationId, routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
    });
    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId: expoStationId, routeType: 'ASSEMBLE', isRequired: true, sortOrder: 0 },
    });

    // Payment instruction
    await prisma.paymentInstruction.create({
      data: {
        tenantId,
        branchId,
        method: 'CBE',
        label: 'CBE Birr',
        accountHolder: 'Test',
        accountIdentifier: '123',
        instructions: 'Transfer',
      },
    });

    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branch2Id}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;

    // ─── Login ───────────────────────────────────────────────────
    ownerToken = await login(app, ownerEmail);
    managerToken = await login(app, managerEmail);
    kitchenToken = await login(app, kitchenEmail);
    waiterToken = await login(app, waiterEmail);
    cashierToken = await login(app, cashierEmail);
    waiter2Token = await login(app, waiter2Email);
    owner2Token = await login(app, owner2Email);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
      // Only delete this run's explicitly created tenants. Never use undefined
      // Prisma filters (which are omitted and could turn cleanup into a wipe).
      const tenantIds = [tenantId, tenant2Id].filter((id): id is string => Boolean(id));
      const emails = [ownerEmail, kitchenEmail, managerEmail, waiterEmail,
        cashierEmail, waiter2Email, owner2Email];
      await prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
        const scope = { tenantId: { in: tenantIds } };
        await tx.serviceNotification.deleteMany({ where: scope });
        await tx.kitchenTicketLine.deleteMany({ where: scope });
        await tx.kitchenTicketHistory.deleteMany({ where: scope });
        await tx.kitchenTicket.deleteMany({ where: scope });
        const branches = await tx.branch.findMany({ where: scope, select: { id: true } });
        await tx.stationTicketCounter.deleteMany({ where: { branchId: { in: branches.map((b) => b.id) } } });
        await tx.branchOrderCounter.deleteMany({ where: { branchId: { in: branches.map((b) => b.id) } } });
        await tx.menuItemStation.deleteMany({ where: scope });
        await tx.payment.deleteMany({ where: scope });
        await tx.shiftReportSnapshot.deleteMany({ where: scope });
        await tx.cashShift.deleteMany({ where: scope });
        await tx.paymentInstruction.deleteMany({ where: scope });
        await tx.orderLineModifier.deleteMany({ where: scope });
        await tx.orderLine.deleteMany({ where: scope });
        await tx.orderStatusHistory.deleteMany({ where: scope });
        await tx.order.deleteMany({ where: scope });
        await tx.featureSetting.deleteMany({ where: scope });
        await tx.tenantEntitlement.deleteMany({ where: scope });
        await tx.branchAssignment.deleteMany({ where: scope });
        await tx.tenantMembership.deleteMany({ where: scope });
        await tx.branchMenuItem.deleteMany({ where: scope });
        await tx.branchFulfillmentPolicy.deleteMany({ where: scope });
        await tx.kitchenStation.deleteMany({ where: scope });
        await tx.kitchen.deleteMany({ where: scope });
        await tx.menuItemVariant.deleteMany({ where: scope });
        await tx.menuItem.deleteMany({ where: scope });
        await tx.menuCategory.deleteMany({ where: scope });
        await tx.auditLog.deleteMany({ where: scope });
        await tx.outboxEvent.deleteMany({ where: scope });
        await tx.branch.deleteMany({ where: scope });
        await tx.authSession.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
        await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
        await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }, { timeout: 30_000 });
      expect(await prisma.tenant.count({ where: { id: { in: tenantIds } } })).toBe(0);
      expect(await prisma.user.count({ where: { email: { in: emails } } })).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Helper: create/confirm via HTTP and require actual outbox routing.
  // Never manufacture tickets to conceal a failed integration boundary.
  // ──────────────────────────────────────────────────────────────
  async function createAndConfirmOrder(
    _token: string,
    oid: string,
  ): Promise<{ orderId: string; orderVersion: number; grillTicketId: string; expoTicketId: string }> {
    const createToken = ownerToken;
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${createToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderType: 'POS', lines: [{ variantId, quantity: 2 }] });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.order.id;
    const orderVersion = orderRes.body.data.order.version;

    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/cash`)
      .set('Authorization', `Bearer ${createToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderId, idempotencyKey: `ewf-cash-${oid}-${ts}` });
    expect(payRes.status).toBe(201);

    const shiftRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/open`)
      .set('Authorization', `Bearer ${createToken}`)
      .set('x-tenant-id', tenantId)
      .send({ openingCashMinor: '100000' });
    expect([201, 409]).toContain(shiftRes.status);

    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
      .set('Authorization', `Bearer ${createToken}`)
      .set('x-tenant-id', tenantId);
    expect(confirmRes.status).toBe(200);

    let tickets = await prisma.kitchenTicket.findMany({
      where: { tenantId, branchId, orderId },
      orderBy: { createdAt: 'asc' },
    });
    // Drain bounded batches: unrelated event types must not make tests bypass routing.
    for (let attempt = 0; attempt < 20 && tickets.length < 2; attempt++) {
      await outboxProcessor.poll(true);
      tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId },
        orderBy: { createdAt: 'asc' },
      });
    }

    expect(tickets.length).toBe(2);
    const confirmedEvent = await prisma.outboxEvent.findFirst({
      where: { tenantId, branchId, aggregateId: orderId, eventType: 'order.confirmed' },
    });
    expect(confirmedEvent?.publishedAt).not.toBeNull();
    expect(confirmedEvent).not.toBeNull();

    const grillTicket = tickets.find((t) => t.stationId === grillStationId)!;
    const expoTicket = tickets.find((t) => t.stationId === expoStationId)!;
    expect(grillTicket).toBeDefined();
    expect(expoTicket).toBeDefined();

    return { orderId, orderVersion, grillTicketId: grillTicket.id, expoTicketId: expoTicket.id };
  }

  // Helper: bump a ticket through QUEUED → IN_PROGRESS → READY
  async function bumpTicketToReady(ticketId: string, startVersion: number): Promise<number> {
    let version = startVersion;

    let res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: version });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    version = res.body.data.version;

    res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: version });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('READY');
    return res.body.data.version;
  }

  // ──────────────────────────────────────────────────────────────
  // 1. EXPO → WAITER HAPPY PATH (Full Lifecycle)
  // ──────────────────────────────────────────────────────────────
  describe('Full Expo → Waiter lifecycle', () => {
    it('creates order → bumps prep → READY_FOR_EXPO', async () => {
      const { orderId, grillTicketId, expoTicketId } = await createAndConfirmOrder(kitchenToken, 'full-life');

      // Bump grill ticket to READY (expo stays QUEUED)
      await bumpTicketToReady(grillTicketId, 1);

      // Verify fulfillment is READY_FOR_EXPO (grill ready, expo still queued)
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('READY_FOR_EXPO');

      // Verify the expo ticket is still QUEUED
      const expoTicket = await prisma.kitchenTicket.findUnique({ where: { id: expoTicketId } });
      expect(expoTicket!.status).toBe('QUEUED');

      // Verify committed HTTP transitions reach the real outbox handler, rather
      // than relying on best-effort broadcasts made directly by the service.
      const gateway = app.get(KdsGateway) as KdsGateway;
      const invalidated = vi.spyOn(gateway, 'broadcastTicketInvalidated');
      try {
        let events = await prisma.outboxEvent.findMany({ where: {
          tenantId, branchId, aggregateId: grillTicketId,
          eventType: { in: ['ticket.in_progress', 'ticket.ready'] },
        } });
        expect(events).toHaveLength(2);
        for (let attempt = 0; attempt < 10 && events.some((event) => !event.publishedAt); attempt++) {
          await outboxProcessor.poll(true);
          events = await prisma.outboxEvent.findMany({ where: {
            tenantId, branchId, aggregateId: grillTicketId,
            eventType: { in: ['ticket.in_progress', 'ticket.ready'] },
          } });
        }
        expect(events.every((event) => event.status === 'PUBLISHED' && event.publishedAt)).toBe(true);
        expect(invalidated).toHaveBeenCalledWith(branchId, grillStationId, expect.objectContaining({
          orderId, ticketId: grillTicketId, eventId: expect.any(String), version: 3,
        }));
      } finally {
        invalidated.mockRestore();
      }
    });

    it('expo releases order → READY_FOR_SERVICE', async () => {
      const { orderId, grillTicketId, expoTicketId } = await createAndConfirmOrder(kitchenToken, 'release');

      // Bump grill → READY (status: READY_FOR_EXPO)
      const grillVersion = await bumpTicketToReady(grillTicketId, 1);

      // Expo releases the order (bypassing expo ticket bump)
      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });
      expect(res.status).toBe(200);
      expect(res.body.data.fulfillmentStatus).toBe('READY_FOR_SERVICE');

      // Verify DB state
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('READY_FOR_SERVICE');
      expect(order!.expoReleasedAt).not.toBeNull();
      expect(order!.readyForServiceAt).not.toBeNull();
    });

    it('manager assigns waiter → order assigned', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'assign');
      await bumpTicketToReady(
        (await prisma.kitchenTicket.findFirst({ where: { orderId, stationId: grillStationId } }))!.id,
        1,
      );

      // Release from expo
      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });

      // Manager assigns waiter
      const assignRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/assign-waiter`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.assignedWaiterUserId).toBe(waiterUserId);

      // Verify DB
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.assignedWaiterUserId).toBe(waiterUserId);
    });

    it('waiter self-claims order', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'claim');
      await bumpTicketToReady(
        (await prisma.kitchenTicket.findFirst({ where: { orderId, stationId: grillStationId } }))!.id,
        1,
      );

      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });

      // Waiter self-claims
      const claimRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/claim`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId);
      expect(claimRes.status).toBe(200);
      expect(claimRes.body.data.assignedWaiterUserId).toBe(waiterUserId);

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.assignedWaiterUserId).toBe(waiterUserId);
    });

    it('waiter collects ready work', async () => {
      const { orderId, grillTicketId, expoTicketId } = await createAndConfirmOrder(kitchenToken, 'collect');
      await bumpTicketToReady(grillTicketId, 1);

      // Release from expo
      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });

      // Assign waiter
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/assign-waiter`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });

      // Collect
      const orderAfter = await prisma.order.findUnique({ where: { id: orderId } });
      const collectRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/collect`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderAfter!.version });
      expect(collectRes.status).toBe(200);
    });

    it('waiter serves order → SERVED', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'serve');
      const grillVersion = (await prisma.kitchenTicket.findUnique({ where: { id: grillTicketId } }))!.version;
      await bumpTicketToReady(grillTicketId, grillVersion);

      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      const releaseRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });
      expect(releaseRes.status).toBe(200);

      // Serve
      const orderAfterRelease = await prisma.order.findUnique({ where: { id: orderId } });
      const serveRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/serve`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderAfterRelease!.version });
      expect(serveRes.status).toBe(200);
      expect(serveRes.body.data.fulfillmentStatus).toBe('SERVED');

      // Verify DB
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('SERVED');
      expect(order!.servedAt).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 2. EXPO RECALL
  // ──────────────────────────────────────────────────────────────
  describe('Expo recall', () => {
    it('manager recalls a released order back to READY_FOR_EXPO', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'recall');
      await bumpTicketToReady(grillTicketId, 1);

      const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: orderBefore!.version });

      // Recall
      const orderAfterRelease = await prisma.order.findUnique({ where: { id: orderId } });
      const recallRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/recall`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'Wrong items', expectedVersion: orderAfterRelease!.version });
      expect(recallRes.status).toBe(200);
      expect(recallRes.body.data.fulfillmentStatus).toBe('READY_FOR_EXPO');
      expect(recallRes.body.data.expoReleasedAt).toBeNull();
    });

    it('rejects recall if order already served', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'recall-served');
      await bumpTicketToReady(grillTicketId, 1);

      let order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/serve`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      // Try to recall served order
      order = await prisma.order.findUnique({ where: { id: orderId } });
      const recallRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/recall`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'oops', expectedVersion: order!.version });
      expect(recallRes.status).toBe(409);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 3. SERVICE BOARD
  // ──────────────────────────────────────────────────────────────
  describe('Service board', () => {
    it('returns assigned orders for the waiter', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'board');
      await bumpTicketToReady(grillTicketId, 1);

      let order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/assign-waiter`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });

      // Get service board
      const boardRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/service-board?scope=mine`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId);
      expect(boardRes.status).toBe(200);
      expect(boardRes.body.data.length).toBeGreaterThanOrEqual(1);

      const found = boardRes.body.data.find((o: any) => o.id === orderId);
      expect(found).toBeDefined();
      expect(found.assignedWaiterUserId).toBe(waiterUserId);
      expect(found.assignedWaiterPhone).toBe(waiterPhone);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 4. EXPO LIST & DETAIL
  // ──────────────────────────────────────────────────────────────
  describe('Expo list and detail', () => {
    it('collects exact quantities once under concurrent Expo submissions', async () => {
      const { orderId, grillTicketId, expoTicketId } = await createAndConfirmOrder(kitchenToken, 'expo-collect-race');
      await bumpTicketToReady(grillTicketId, 1);
      await bumpTicketToReady(expoTicketId, 1);
      const before = await prisma.order.findFirstOrThrow({ where: { id: orderId, tenantId, branchId } });
      const collect = () => request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/collect`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: before.version });
      const responses = await Promise.all([collect(), collect()]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const after = await prisma.order.findFirstOrThrow({ where: { id: orderId, tenantId, branchId } });
      expect(after.version).toBe(before.version + 1);
      const lines = await prisma.kitchenTicketLine.findMany({
        where: { tenantId, branchId, ticketId: { in: [grillTicketId, expoTicketId] } },
      });
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.quantityCollected).toBe(line.quantityReady);
        expect(line.quantityReady).toBe(line.quantity);
        expect(line.collectedAt).not.toBeNull();
      }
      expect(await prisma.outboxEvent.count({
        where: { tenantId, branchId, aggregateId: orderId, eventType: 'order.collected' },
      })).toBe(1);
    });

    it('lists orders on the expo screen', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'expo-list');
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/expo/orders`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
    });

    it('gets expo detail for a specific order', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'expo-detail');
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/expo/orders/${orderId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.id).toBe(orderId);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 5. CROSS-TENANT ISOLATION
  // ──────────────────────────────────────────────────────────────
  describe('Durable notification HTTP reads', () => {
    it('rolls back notification creation when the real audit insert fails, then permits retry', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'notification-rollback');
      const notifications = app.get(ServiceNotificationService) as ServiceNotificationService;
      const params = {
        tenantId, branchId, orderId, assignedUserId: waiterUserId,
        type: ServiceNotificationType.ORDER_READY, dedupeKey: `notification-rollback-${ts}`,
      };
      // A nonexistent actor triggers the actual AuditLog FK after notification
      // insertion. No mock replaces the database or transaction in this test.
      await expect(notifications.createNotification({
        ...params, actorUserId: `missing-audit-actor-${ts}`,
      })).rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.serviceNotification.count({ where: {
        tenantId, branchId, dedupeKey: params.dedupeKey,
      } })).toBe(0);
      const result = await notifications.createNotification({ ...params, actorUserId: waiterUserId });
      expect(await prisma.serviceNotification.count({ where: {
        tenantId, branchId, dedupeKey: params.dedupeKey,
      } })).toBe(1);
      expect(await prisma.auditLog.count({ where: {
        tenantId, branchId, entityId: result.id, action: 'SERVICE_NOTIFICATION_CREATE',
      } })).toBe(1);
    });

    it('deduplicates concurrent notification creation with exactly one audit record', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'notification-concurrent');
      const notifications = app.get(ServiceNotificationService) as ServiceNotificationService;
      const params = {
        tenantId, branchId, orderId, assignedUserId: waiterUserId,
        type: ServiceNotificationType.ORDER_READY, dedupeKey: `notification-concurrent-${ts}`,
      };
      const results = await Promise.all(Array.from({ length: 5 }, () => notifications.createNotification(params)));
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      expect(await prisma.serviceNotification.count({ where: { tenantId, branchId, dedupeKey: params.dedupeKey } })).toBe(1);
      expect(await prisma.auditLog.count({ where: {
        tenantId, branchId, entityType: 'ServiceNotification', entityId: results[0].id,
        action: 'SERVICE_NOTIFICATION_CREATE',
      } })).toBe(1);
    });

    it('Owner/Manager can read branch history; Waiter cannot spoof another recipient', async () => {
      // These explicit fixtures test the read boundary, not notification creation.
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'notification-read');
      const manager = await prisma.user.findUniqueOrThrow({ where: { email: managerEmail } });
      const own = await prisma.serviceNotification.create({ data: {
        tenantId, branchId, orderId, assignedUserId: waiterUserId, type: 'ORDER_READY',
        dedupeKey: `notification-read-own-${ts}`, collectionLabelSnapshot: 'Main pass',
      } });
      const other = await prisma.serviceNotification.create({ data: {
        tenantId, branchId, orderId, assignedUserId: manager.id, type: 'ESCALATION',
        dedupeKey: `notification-read-other-${ts}`, collectionLabelSnapshot: 'Main pass',
      } });
      for (const token of [ownerToken, managerToken]) {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/branches/${branchId}/service-notifications`)
          .set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId);
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: own.id }), expect.objectContaining({ id: other.id }),
        ]));
      }
      const personal = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/service-notifications?assignedUserId=${manager.id}`)
        .set('Authorization', `Bearer ${waiterToken}`).set('x-tenant-id', tenantId);
      expect(personal.status).toBe(200);
      expect(personal.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: own.id })]));
      expect(personal.body.data.every((notification: { assignedUserId: string }) => notification.assignedUserId === waiterUserId)).toBe(true);
      expect(personal.body.data.some((notification: { id: string }) => notification.id === other.id)).toBe(false);
    });

    it('denies unauthenticated, forbidden-role, foreign-tenant and unassigned-branch reads', async () => {
      const path = `/api/v1/branches/${branchId}/service-notifications`;
      expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
      for (const token of [kitchenToken, cashierToken, waiter2Token]) {
        const response = await request(app.getHttpServer()).get(path)
          .set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId);
        expect(response.status).toBe(403);
      }
      const foreign = await request(app.getHttpServer()).get(path)
        .set('Authorization', `Bearer ${owner2Token}`).set('x-tenant-id', tenant2Id);
      expect(foreign.status).toBe(403);
    });

    it('enforces a disabled branch KDS feature instead of returning fabricated emptiness', async () => {
      const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
      const setting = await prisma.featureSetting.create({ data: {
        tenantId, branchId, featureKey: 'KDS', enabled: false, updatedByUserId: owner.id,
      } });
      try {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/branches/${branchId}/service-notifications`)
          .set('Authorization', `Bearer ${waiterToken}`).set('x-tenant-id', tenantId);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FEATURE_DISABLED');
      } finally {
        await prisma.featureSetting.delete({ where: { id: setting.id } });
      }
    });
  });

  describe('Cross-tenant isolation', () => {
    it('rejects expo release with tenant2 token on tenant1 order', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'xt-tenant-release');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .set('x-tenant-id', tenant2Id)
        .send({ expectedVersion: 1 });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects waiter assign with tenant2 token on tenant1 order', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'xt-tenant-assign');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/assign-waiter`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .set('x-tenant-id', tenant2Id)
        .send({ waiterUserId });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects service board for tenant2 querying tenant1 branch', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/service-board?scope=mine`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .set('x-tenant-id', tenant2Id);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 6. CROSS-BRANCH ISOLATION
  // ──────────────────────────────────────────────────────────────
  describe('Cross-branch isolation', () => {
    it('rejects waiter2 (branch2-only) accessing branch1 expo', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'xb-expo');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${waiter2Token}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      // waiter2 doesn't have KITCHEN_STAFF role — should be 403
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects waiter2 claiming order on branch1', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'xb-claim');
      await bumpTicketToReady(
        (await prisma.kitchenTicket.findFirst({ where: { orderId, stationId: grillStationId } }))!.id,
        1,
      );

      let order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      // waiter2 is not assigned to branch1 — claim should fail
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/claim`)
        .set('Authorization', `Bearer ${waiter2Token}`)
        .set('x-tenant-id', tenantId);
      // waiter2 IS assigned to branch2 but not branch1 via branchAssignment
      // However waiter2 does NOT have WAITER membership on this tenant... actually they do via wm2
      // The key is waiter2 doesn't have branchAssignment for branch1
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 7. ROLE-BASED ACCESS DENIAL
  // ──────────────────────────────────────────────────────────────
  describe('Role-based access denial', () => {
    it('cashier cannot release from expo (only OWNER/MANAGER/KITCHEN_STAFF allowed)', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'rbac-release');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(403);
    });

    it('cashier cannot recall from expo (only OWNER/MANAGER allowed)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/fake-id/recall`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'test', expectedVersion: 1 });
      // Either 403 (role denied) or 404 (order not found — but role check happens first)
      expect(res.status).toBeGreaterThanOrEqual(403);
    });

    it('cashier cannot assign waiter (only OWNER/MANAGER allowed)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/fake-id/assign-waiter`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });
      expect(res.status).toBeGreaterThanOrEqual(403);
    });

    it('kitchen_staff cannot assign waiter (only OWNER/MANAGER allowed)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/fake-id/assign-waiter`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });
      expect(res.status).toBeGreaterThanOrEqual(403);
    });

    it('kitchen_staff cannot serve orders (only OWNER/MANAGER/CASHIER/WAITER allowed)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/fake-id/serve`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBeGreaterThanOrEqual(403);
    });

    it('waiter cannot release from expo (only OWNER/MANAGER/KITCHEN_STAFF/CASHIER allowed)', async () => {
      const { orderId } = await createAndConfirmOrder(kitchenToken, 'rbac-waiter-release');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 8. IDEMPOTENCY & CONFLICT GUARDS
  // ──────────────────────────────────────────────────────────────
  describe('Idempotency and conflict guards', () => {
    it('rejects double-release of the same order', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'dbl-release');
      await bumpTicketToReady(grillTicketId, 1);

      let order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      // Second release attempt
      order = await prisma.order.findUnique({ where: { id: orderId } });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });
      expect(res.status).toBe(409);
    });

    it('rejects serve on a non-existent order', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/00000000-0000-0000-0000-000000000000/serve`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(404);
    });

    it('rejects claim on an order assigned to another waiter', async () => {
      const { orderId, grillTicketId } = await createAndConfirmOrder(kitchenToken, 'claim-conflict');
      await bumpTicketToReady(grillTicketId, 1);

      let order = await prisma.order.findUnique({ where: { id: orderId } });
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/expo/orders/${orderId}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: order!.version });

      // Assign to waiter first
      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/assign-waiter`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ waiterUserId });

      // waiter2 (different user, no branch1 access) tries to claim — blocked by BranchScopeGuard (403)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders/${orderId}/claim`)
        .set('Authorization', `Bearer ${waiter2Token}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });
  });
});
