import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
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

describe('Kitchen Ticket Lifecycle — Integration (e2e)', () => {
  let app: any;
  let outboxProcessor: OutboxProcessor;
  let ownerToken: string;
  let kitchenToken: string;
  let managerToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;
  let grillStationId: string;
  let expoStationId: string;

  const ownerEmail = `ktl-owner-${ts}@test.com`;
  const kitchenEmail = `ktl-kitchen-${ts}@test.com`;
  const managerEmail = `ktl-manager-${ts}@test.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    outboxProcessor = app.get(OutboxProcessor);
    outboxProcessor.stop();
    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // Tenant + branch
    const tenant = await prisma.tenant.create({
      data: { name: 'KTLTest', slug: `ktl-test-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: 'main', isActive: true },
    });
    branchId = branch.id;

    // Users
    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });

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
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mgm.id } });

    ownerToken = await login(app, ownerEmail);
    kitchenToken = await login(app, kitchenEmail);
    managerToken = await login(app, managerEmail);

    // Menu
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
        sku: 'KTL-001',
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

    // Kitchen + stations (normal + expo)
    const kitchen1 = await prisma.kitchen.create({
      data: { tenantId, branchId, name: 'Main Kitchen', isActive: true },
    });

    grillStationId = (await prisma.kitchenStation.create({
      data: { tenantId, branchId, kitchenId: kitchen1.id, name: 'Grill', displayOrder: 0, isExpo: false },
    })).id;

    expoStationId = (await prisma.kitchenStation.create({
      data: { tenantId, branchId, kitchenId: kitchen1.id, name: 'Expo', displayOrder: 1, isExpo: true },
    })).id;

    // Routes: item → PREPARE on grill, ASSEMBLE on expo
    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId: grillStationId, routeType: 'PREPARE', isRequired: true, sortOrder: 0 },
    });
    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId: expoStationId, routeType: 'ASSEMBLE', isRequired: true, sortOrder: 0 },
    });

    // Cash payment instruction
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.kitchenTicketLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenTicketHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenTicket.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.stationTicketCounter.deleteMany({ where: { branchId } }).catch(() => {});
    await prisma.menuItemStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.paymentInstruction.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLineModifier.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchMenuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchen.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, kitchenEmail, managerEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('Full ticket lifecycle', () => {
    let orderId: string;
    let ticketId: string;
    let ticketVersion: number;
    let grillTicketId: string;
    let grillTicketVersion: number;

    it('creates order and confirms via cash', async () => {
      const orderRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderType: 'POS', lines: [{ variantId, quantity: 2 }] });
      expect(orderRes.status).toBe(201);
      orderId = orderRes.body.data.order.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId, idempotencyKey: `ktl-cash-${ts}` });
      expect(payRes.status).toBe(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId);
      expect(confirmRes.status).toBe(200);

      await outboxProcessor.poll(true);

      // Should create 2 tickets: one for grill (PREPARATION) and one for expo (EXPO)
      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tickets.length).toBe(2);

      const grillTicket = tickets.find((t) => t.stationId === grillStationId)!;
      const expoTicket = tickets.find((t) => t.stationId === expoStationId)!;

      expect(grillTicket).toBeDefined();
      expect(grillTicket.ticketType).toBe('PREPARATION');
      expect(grillTicket.status).toBe('QUEUED');
      expect(grillTicket.kitchenId).not.toBeNull();

      expect(expoTicket).toBeDefined();
      expect(expoTicket.ticketType).toBe('EXPO');
      expect(expoTicket.status).toBe('QUEUED');

      grillTicketId = grillTicket.id;
      grillTicketVersion = grillTicket.version;
      ticketId = expoTicket.id;
      ticketVersion = expoTicket.version;
    });

    it('verifies initial line states', async () => {
      const lines = await prisma.kitchenTicketLine.findMany({
        where: { ticketId: grillTicketId },
      });
      expect(lines.length).toBe(1);
      expect(lines[0].status).toBe('QUEUED');
      expect(lines[0].quantity).toBe(2);
      expect(lines[0].quantityPrepared).toBe(0);
      expect(lines[0].quantityReady).toBe(0);
      expect(lines[0].routeType).toBe('PREPARE');

      const expoLines = await prisma.kitchenTicketLine.findMany({
        where: { ticketId },
      });
      expect(expoLines.length).toBe(1);
      expect(expoLines[0].routeType).toBe('ASSEMBLE');
    });

    it('bumps grill ticket: QUEUED → IN_PROGRESS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${grillTicketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: grillTicketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      grillTicketVersion = res.body.data.version;

      // Verify line quantityPrepared set to quantity
      const lines = await prisma.kitchenTicketLine.findMany({ where: { ticketId: grillTicketId } });
      expect(lines[0].status).toBe('IN_PROGRESS');
      expect(lines[0].quantityPrepared).toBe(2);

      // Fulfillment should be PREPARING
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('PREPARING');
    });

    it('bumps grill ticket: IN_PROGRESS → READY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${grillTicketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: grillTicketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
      grillTicketVersion = res.body.data.version;

      // Verify line ready counters
      const lines = await prisma.kitchenTicketLine.findMany({ where: { ticketId: grillTicketId } });
      expect(lines[0].status).toBe('READY');
      expect(lines[0].quantityReady).toBe(2);
      expect(lines[0].readyAt).not.toBeNull();

      // Grill ready but expo not → READY_FOR_EXPO
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('READY_FOR_EXPO');
    });

    it('recalls grill ticket: READY → IN_PROGRESS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${grillTicketId}/recall`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'Wrong portion', expectedVersion: grillTicketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      grillTicketVersion = res.body.data.version;

      // Line reverted
      const lines = await prisma.kitchenTicketLine.findMany({ where: { ticketId: grillTicketId } });
      expect(lines[0].status).toBe('IN_PROGRESS');
      expect(lines[0].quantityReady).toBe(0);

      // Back to PREPARING
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('PREPARING');
    });

    it('re-bumps grill: IN_PROGRESS → READY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${grillTicketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: grillTicketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
      grillTicketVersion = res.body.data.version;

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('READY_FOR_EXPO');
    });

    it('bumps expo ticket: QUEUED → IN_PROGRESS → READY', async () => {
      let res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      ticketVersion = res.body.data.version;

      res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
      ticketVersion = res.body.data.version;

      // Both tickets READY → READY_FOR_SERVICE
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.fulfillmentStatus).toBe('READY_FOR_SERVICE');
      expect(order!.readyForServiceAt).not.toBeNull();
    });

    it('completes expo ticket: READY → COMPLETED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/complete`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('verifies outbox events were emitted', async () => {
      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, orderId, aggregateType: 'Order' },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it('verifies ticket history was recorded', async () => {
      const history = await prisma.kitchenTicketHistory.findMany({
        where: { tenantId, ticketId: grillTicketId },
        orderBy: { createdAt: 'asc' },
      });
      // Should have at least: QUEUED→IN_PROGRESS, IN_PROGRESS→READY, READY→IN_PROGRESS, IN_PROGRESS→READY
      expect(history.length).toBeGreaterThanOrEqual(4);
    });

    it('rejects version conflict on stale bump', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${grillTicketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(409);
    });
  });

  describe('Cancel path', () => {
    let cancelOrderId: string;
    let cancelTicketId: string;
    let cancelTicketVersion: number;

    it('creates order and confirms', async () => {
      const orderRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
      expect(orderRes.status).toBe(201);
      cancelOrderId = orderRes.body.data.order.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: cancelOrderId, idempotencyKey: `ktl-cancel-cash-${ts}` });
      expect(payRes.status).toBe(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId);
      expect(confirmRes.status).toBe(200);

      await outboxProcessor.poll(true);

      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId: cancelOrderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tickets.length).toBe(2);

      const grillTicket = tickets.find((t) => t.stationId === grillStationId)!;
      cancelTicketId = grillTicket.id;
      cancelTicketVersion = grillTicket.version;
    });

    it('cancels QUEUED ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${cancelTicketId}/cancel`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'Customer left', expectedVersion: cancelTicketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');

      // Line also cancelled
      const lines = await prisma.kitchenTicketLine.findMany({ where: { ticketId: cancelTicketId } });
      expect(lines[0].status).toBe('CANCELLED');
    });

    it('rejects bump on CANCELLED ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${cancelTicketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: cancelTicketVersion });
      expect(res.status).toBe(409);
    });
  });
});
