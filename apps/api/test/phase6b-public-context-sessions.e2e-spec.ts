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

describe('Phase 6B — Public Context & Table Sessions (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let waiterToken: string;
  let managerToken: string;
  let tenantId: string;
  let branchId: string;
  let tableId: string;
  let qrTokenRaw: string;
  let publicSlug: string;

  const ownerEmail = `phase6b-owner-${ts}@test.com`;
  const waiterEmail = `phase6b-waiter-${ts}@test.com`;
  const managerEmail = `phase6b-manager-${ts}@test.com`;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    // Purge stale outbox events
    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });

    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: { name: 'Phase6BTest', slug: `phase6b-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    // Enable TABLE_QR_ORDERING and PICKUP_ORDERING features
    await prisma.featureSetting.create({
      data: { tenantId, featureKey: 'TABLE_QR_ORDERING', enabled: true, updatedByUserId: 'system' },
    });
    await prisma.featureSetting.create({
      data: { tenantId, featureKey: 'PICKUP_ORDERING', enabled: true, updatedByUserId: 'system' },
    });

    // Create branch with publicSlug
    const branchSlug = `phase6b-main-${ts}`;
    publicSlug = `restaurant-phase6b-${ts}`;
    const branch = await prisma.branch.create({
      data: {
        tenantId,
        name: 'Main Branch',
        slug: branchSlug,
        publicSlug,
        isActive: true,
      },
    });
    branchId = branch.id;

    // Create owner
    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    // Create waiter
    const waiter = await prisma.user.create({
      data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' },
    });
    const wm = await prisma.tenantMembership.create({
      data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: wm.id } });
    waiterToken = await login(app, waiterEmail);

    // Create manager
    const manager = await prisma.user.create({
      data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' },
    });
    const mm = await prisma.tenantMembership.create({
      data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });
    managerToken = await login(app, managerEmail);

    // Create table and QR token
    const table = await prisma.restaurantTable.create({
      data: { tenantId, branchId, label: 'T1', capacity: 4, isActive: true },
    });
    tableId = table.id;

    // Create QR token (raw token is generated, we need to get it)
    const qrRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/tables/${tableId}/qr-token/rotate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ reason: 'test' });
    qrTokenRaw = qrRes.body.data.raw;

    // Create menu items for order creation
    const category = await prisma.menuCategory.create({
      data: { tenantId, name: 'Food', sortOrder: 0, isActive: true },
    });
    const item = await prisma.menuItem.create({
      data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true },
    });
    const variant = await prisma.menuItemVariant.create({
      data: { tenantId, name: 'Regular', sku: 'BURG-6B', basePriceMinor: 5000n, isActive: true, isDefault: true, menuItem: { connect: { id: item.id } } },
    });

    // Initialize branch order counter
    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, NOW(), NOW())
      ON CONFLICT ("branchId") DO NOTHING
    `;
  });

  afterAll(async () => {
    await app.close();
    // Cleanup in FK-safe order
    await prisma.kitchenTicketLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenTicketHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenTicket.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.stationTicketCounter.deleteMany({ where: { branchId: { in: [branchId] } } }).catch(() => {});
    await prisma.paymentProof.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.paymentInstruction.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.idempotencyRecord.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLineModifier.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.diningSession.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchMenuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, waiterEmail, managerEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ─── Public Slug Resolution ──────────────────────

  it('1. resolves public slug to restaurant context', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/public/restaurants/${publicSlug}`);

    expect(res.status).toBe(200);
    expect(res.body.data.branch.name).toBe('Main Branch');
    expect(res.body.data.branch.publicSlug).toBe(publicSlug);
    expect(res.body.data.pickupEnabled).toBe(true);
    expect(res.body.data.tableQrEnabled).toBe(false);
    expect(res.body.data.availablePaymentMethods).toContain('BANK_TRANSFER');
    expect(res.body.data.availablePaymentMethods).toContain('TELEBIRR');
  });

  it('2. invalid slug returns 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/public/restaurants/nonexistent-slug');

    expect(res.status).toBe(404);
  });

  it('3. public slug menu endpoint returns pickup-only menu', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/public/restaurants/${publicSlug}/menu`);

    expect(res.status).toBe(200);
    expect(res.body.data.context.branch.publicSlug).toBe(publicSlug);
  });

  // ─── Table QR Context Resolution ──────────────────

  it('4. resolves QR token to table context', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/public/table-context/resolve')
      .send({ token: qrTokenRaw });

    expect(res.status).toBe(201);
    expect(res.body.data.table.label).toBe('T1');
    expect(res.body.data.table.capacity).toBe(4);
    expect(res.body.data.availableOrderTypes).toContain('DINE_IN');
    expect(res.body.data.availableOrderTypes).toContain('TAKEAWAY');
    expect(res.body.data.availablePaymentMethods).toContain('CASH');
  });

  it('5. invalid QR token returns 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/public/table-context/resolve')
      .send({ token: 'invalid-token-abc123' });

    expect(res.status).toBe(404);
  });

  // ─── Table Occupancy Projection ──────────────────

  it('6. table-operations shows all tables with no active sessions', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/table-operations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const t1 = res.body.data.find((t: any) => t.tableId === tableId);
    expect(t1).toBeDefined();
    expect(t1.sessionId).toBeNull();
    expect(t1.openOrderCount).toBe(0);
  });

  it('7. waiter can view table-operations', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/table-operations`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ─── Session Lifecycle ──────────────────────────

  let dineInOrderId: string;

  it('8. creates a DINE_IN order and associates with table', async () => {
    // Get the variant ID
    const variant = await prisma.menuItemVariant.findFirst({
      where: { tenantId, sku: 'BURG-6B' },
    });
    expect(variant).not.toBeNull();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        orderType: 'DINE_IN',
        tableId,
        lines: [{ variantId: variant!.id, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    dineInOrderId = res.body.data.order.id;

    // Create a CASH payment directly via Prisma
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        branchId,
        orderId: dineInOrderId,
        method: 'CASH',
        amountMinor: res.body.data.order.totalMinor,
        currency: 'ETB',
        status: 'PENDING',
      },
    });

    // Confirm cash payment — this should open/join session
    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payment.id}/confirm-cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(confirmRes.status).toBe(200);

    // Verify session was created
    const sessions = await prisma.diningSession.findMany({
      where: { tenantId, branchId, tableId, status: 'OPEN' },
    });
    expect(sessions.length).toBe(1);

    // Verify order is linked to session
    const order = await prisma.order.findUnique({ where: { id: dineInOrderId } });
    expect(order!.diningSessionId).toBe(sessions[0].id);
  });

  it('9. second DINE_IN order joins existing session', async () => {
    const variant = await prisma.menuItemVariant.findFirst({
      where: { tenantId, sku: 'BURG-6B' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        orderType: 'DINE_IN',
        tableId,
        lines: [{ variantId: variant!.id, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    const order2Id = res.body.data.order.id;

    // Create and confirm CASH payment
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        branchId,
        orderId: order2Id,
        method: 'CASH',
        amountMinor: res.body.data.order.totalMinor,
        currency: 'ETB',
        status: 'PENDING',
      },
    });

    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payment.id}/confirm-cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(confirmRes.status).toBe(200);

    // Should still be only ONE open session
    const sessions = await prisma.diningSession.findMany({
      where: { tenantId, branchId, tableId, status: 'OPEN' },
    });
    expect(sessions.length).toBe(1);

    // Both orders should reference the same session
    const order2 = await prisma.order.findUnique({ where: { id: order2Id } });
    const order1 = await prisma.order.findUnique({ where: { id: dineInOrderId } });
    expect(order1!.diningSessionId).toBe(sessions[0].id);
    expect(order2!.diningSessionId).toBe(sessions[0].id);
  });

  it('10. table-operations shows occupied table after session opened', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/table-operations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    const t1 = res.body.data.find((t: any) => t.tableId === tableId);
    expect(t1.sessionId).not.toBeNull();
    expect(t1.sessionStatus).toBe('OPEN');
    expect(t1.openOrderCount).toBe(2);
  });

  // ─── Premature Clear Denial ──────────────────────

  let sessionId: string;

  it('11. session details show linked orders', async () => {
    const session = await prisma.diningSession.findFirst({
      where: { tenantId, branchId, tableId, status: 'OPEN' },
    });
    expect(session).not.toBeNull();
    sessionId = session!.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.orders.length).toBe(2);
    expect(res.body.data.version).toBe(1);
  });

  it('12. version conflict returns 409 on OPEN session', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${sessionId}/clear`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 99, clearReason: 'Wrong version' });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Version conflict');
  });

  it('13. clear denied when non-terminal orders remain', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${sessionId}/clear`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 1, clearReason: 'Guests left' });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('TABLE_SESSION_NOT_CLEARABLE');
  });

  // ─── Successful Clear ──────────────────────────

  it('14. owner can clear session after all orders terminal', async () => {
    // Complete both orders (change status to COMPLETED)
    await prisma.order.updateMany({
      where: { diningSessionId: sessionId },
      data: { status: 'COMPLETED' },
    });

    // Owner clear should succeed
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${sessionId}/clear`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 1, clearReason: 'Guests left' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('CLEARED');
    expect(res.body.data.clearedByUserId).toBeDefined();
    expect(res.body.data.clearReason).toBe('Guests left');
    expect(res.body.data.closedAt).not.toBeNull();
  });

  it('15. table-operations shows table free after clear', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/table-operations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    const t1 = res.body.data.find((t: any) => t.tableId === tableId);
    expect(t1.sessionId).toBeNull();
    expect(t1.openOrderCount).toBe(0);
  });

  it('16. clear is idempotent (already cleared)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${sessionId}/clear`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 2, clearReason: 'Already cleared' });

    // Should succeed (idempotent) — already cleared sessions return 201
    expect(res.status).toBe(201);
  });

  it('17. waiter can clear session after all orders terminal', async () => {
    const variant = await prisma.menuItemVariant.findFirst({
      where: { tenantId, sku: 'BURG-6B' },
    });
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        orderType: 'DINE_IN',
        tableId,
        lines: [{ variantId: variant!.id, quantity: 1 }],
      });
    expect(orderRes.status).toBe(201);
    const newOrderId = orderRes.body.data.order.id;

    const payment = await prisma.payment.create({
      data: {
        tenantId,
        branchId,
        orderId: newOrderId,
        method: 'CASH',
        amountMinor: orderRes.body.data.order.totalMinor,
        currency: 'ETB',
        status: 'PENDING',
      },
    });
    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payment.id}/confirm-cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(confirmRes.status).toBe(200);

    const session = await prisma.diningSession.findFirst({
      where: { tenantId, branchId, tableId, status: 'OPEN' },
    });
    expect(session).not.toBeNull();

    await prisma.order.update({
      where: { id: newOrderId },
      data: { status: 'COMPLETED' },
    });

    const clearRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${session!.id}/clear`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 1, clearReason: 'Table cleared by waiter' });

    expect(clearRes.status).toBe(201);
    expect(clearRes.body.data.status).toBe('CLEARED');
    expect(clearRes.body.data.clearedByUserId).toBeDefined();
  });

  it('18. manager is denied from clearing session', async () => {
    const variant = await prisma.menuItemVariant.findFirst({
      where: { tenantId, sku: 'BURG-6B' },
    });
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        orderType: 'DINE_IN',
        tableId,
        lines: [{ variantId: variant!.id, quantity: 1 }],
      });
    expect(orderRes.status).toBe(201);
    const newOrderId = orderRes.body.data.order.id;

    const payment = await prisma.payment.create({
      data: {
        tenantId,
        branchId,
        orderId: newOrderId,
        method: 'CASH',
        amountMinor: orderRes.body.data.order.totalMinor,
        currency: 'ETB',
        status: 'PENDING',
      },
    });
    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payment.id}/confirm-cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(confirmRes.status).toBe(200);

    await prisma.order.update({
      where: { id: newOrderId },
      data: { status: 'COMPLETED' },
    });

    const session = await prisma.diningSession.findFirst({
      where: { tenantId, branchId, tableId, status: 'OPEN' },
    });
    expect(session).not.toBeNull();

    const clearRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/sessions/${session!.id}/clear`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion: 1, clearReason: 'Manager attempt' });

    expect(clearRes.status).toBe(403);
  });
});
