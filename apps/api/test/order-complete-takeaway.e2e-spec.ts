import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
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

describe('Order Complete + Takeaway (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let cashierToken: string;
  let waiterToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;
  let tableId: string;

  const ownerEmail = `oc-owner-${ts}@test.com`;
  const cashierEmail = `oc-cashier-${ts}@test.com`;
  const waiterEmail = `oc-waiter-${ts}@test.com`;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: `OC_${ts}`, slug: `oc-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: `oc-main-${ts}`, timezone: 'Africa/Addis_Ababa', isActive: true },
    });
    branchId = branch.id;

    const cat = await prisma.menuCategory.create({
      data: { tenantId, name: 'Food', sortOrder: 1, isActive: true },
    });
    const item = await prisma.menuItem.create({
      data: { tenantId, categoryId: cat.id, name: 'Burger', description: 'Tasty', isActive: true },
    });
    const variant = await prisma.menuItemVariant.create({
      data: {
        tenantId,
        menuItemId: item.id,
        name: 'Regular',
        basePriceMinor: 5000n,
        sku: `OC-V-${ts}`,
        isDefault: true,
        isActive: true,
      },
    });
    variantId = variant.id;

    await prisma.branchMenuItem.create({
      data: { tenantId, branchId, menuItemId: item.id, isAvailable: true },
    });

    const station = await prisma.kitchenStation.create({
      data: { tenantId, branchId, name: 'Grill', displayOrder: 0 },
    });
    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId: station.id },
    });

    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;

    const table = await prisma.restaurantTable.create({
      data: { tenantId, branchId, label: 'T1', capacity: 4, isActive: true },
    });
    tableId = table.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    const cashier = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });
    cashierToken = await login(app, cashierEmail);

    const waiter = await prisma.user.create({ data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' } });
    const wm = await prisma.tenantMembership.create({ data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: wm.id } });
    waiterToken = await login(app, waiterEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLineModifier.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.restaurantTable.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchMenuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, cashierEmail, waiterEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  async function createPosOrder(orderType = 'POS'): Promise<{ orderId: string; version: number }> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        lines: [{ variantId, quantity: 1 }],
        orderType,
      });
    expect(res.status).toBe(201);
    return { orderId: res.body.data.order.id, version: res.body.data.order.version };
  }

  async function setOrderStatus(orderId: string, status: string) {
    await prisma.order.update({ where: { id: orderId }, data: { status } });
  }

  // ═══════════════════════════════════════════════
  // SECTION 1: Complete Order Endpoint
  // ═══════════════════════════════════════════════
  describe('POST /orders/:orderId/complete', () => {
    it('1. completes a READY order', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(201);
      expect(res.body.data.order.status).toBe('COMPLETED');
      expect(res.body.data.order.completedAt).toBeDefined();
      expect(res.body.data.order.version).toBe(version + 1);
    });

    it('2. completes with cashier role', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(201);
      expect(res.body.data.order.status).toBe('COMPLETED');
    });

    it('3. completes with waiter role', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(201);
      expect(res.body.data.order.status).toBe('COMPLETED');
    });

    it('4. rejects completion of CONFIRMED order', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'CONFIRMED');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Cannot complete order/);
    });

    it('5. rejects completion of IN_PROGRESS order', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'IN_PROGRESS');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(409);
    });

    it('6. rejects completion of already COMPLETED order', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version + 1 });

      expect(res.status).toBe(409);
    });

    it('7. version conflict returns 409', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version + 5 });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/modified by another request/);
    });

    it('8. creates status history entry', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId, toStatus: 'COMPLETED' },
      });
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].fromStatus).toBe('READY');
    });

    it('9. creates audit log entry', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      const audit = await prisma.auditLog.findMany({
        where: { entityId: orderId, action: 'ORDER_COMPLETE' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(1);
    });

    it('10. creates outbox event', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      const outbox = await prisma.outboxEvent.findMany({
        where: { aggregateId: orderId, eventType: 'order.completed' },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it('11. non-existent order returns 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/orders/00000000-0000-0000-0000-000000000000/complete')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });

      expect(res.status).toBe(404);
    });

    it('12. missing expectedVersion is rejected (400 or 409)', async () => {
      const { orderId } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({});

      expect([400, 409]).toContain(res.status);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 2: TAKEAWAY OrderType
  // ═══════════════════════════════════════════════
  describe('TAKEAWAY OrderType', () => {
    it('13. POS order with TAKEAWAY type succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          lines: [{ variantId, quantity: 1 }],
          orderType: 'TAKEAWAY',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.order.orderType).toBe('TAKEAWAY');
      expect(res.body.data.order.tableId).toBeNull();
    });

    it('14. POS order with DINE_IN type succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          lines: [{ variantId, quantity: 1 }],
          orderType: 'DINE_IN',
          tableId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.order.orderType).toBe('DINE_IN');
    });

    it('15. invalid order type returns 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          lines: [{ variantId, quantity: 1 }],
          orderType: 'INVALID',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid orderType/);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 3: State Machine Completeness
  // ═══════════════════════════════════════════════
  describe('State Machine Completeness', () => {
    it('16. READY → COMPLETED is valid', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'READY');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(201);
    });

    it('17. CANCELLED → COMPLETED is rejected', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'CANCELLED');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(409);
    });

    it('18. PENDING_PAYMENT → COMPLETED is rejected', async () => {
      const { orderId, version } = await createPosOrder();
      await setOrderStatus(orderId, 'PENDING_PAYMENT');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: version });

      expect(res.status).toBe(409);
    });
  });
});
