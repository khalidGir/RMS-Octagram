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

describe('Phase 6D — Business Day Close (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let managerToken: string;
  let waiterToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;

  const ownerEmail = `phase6d-owner-${ts}@test.com`;
  const managerEmail = `phase6d-manager-${ts}@test.com`;
  const waiterEmail = `phase6d-waiter-${ts}@test.com`;
  let passwordHash: string;

  // Use a known business date for deterministic testing
  const testBusinessDate = '2026-08-27';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: 'Phase6DTest', slug: `phase6d-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main Branch', slug: `phase6d-main-${ts}`, isActive: true, timezone: 'Africa/Addis_Ababa', businessDayCutoffLocal: '06:00' },
    });
    branchId = branch.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    const manager = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });
    managerToken = await login(app, managerEmail);

    const waiter = await prisma.user.create({ data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' } });
    const wm = await prisma.tenantMembership.create({ data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: wm.id } });
    waiterToken = await login(app, waiterEmail);

    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 0, isActive: true } });
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true } });
    const variant = await prisma.menuItemVariant.create({ data: { tenantId, name: 'Regular', sku: 'BURG-6D', basePriceMinor: 5000n, isActive: true, isDefault: true, menuItem: { connect: { id: item.id } } } });
    variantId = variant.id;

    await prisma.$executeRaw`INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt") VALUES (${branchId}, 0, NOW(), NOW()) ON CONFLICT ("branchId") DO NOTHING`;
  });

  afterAll(async () => {
    await app.close();
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
    await prisma.shiftReportSnapshot.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.cashShift.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.businessDayClose.deleteMany({ where: { tenantId } }).catch(() => {});
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
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, managerEmail, waiterEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  async function createCashPaymentAndConfirm(orderToken: string) {
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${orderToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
    if (orderRes.status !== 201) throw new Error(`Order creation failed: ${JSON.stringify(orderRes.body)}`);
    const orderId = orderRes.body.data.order.id;
    const totalMinor = Number(orderRes.body.data.order.totalMinor);
    const payment = await prisma.payment.create({
      data: { tenantId, branchId, orderId, method: 'CASH', amountMinor: BigInt(totalMinor), currency: 'ETB', status: 'PENDING' },
    });
    const confirmRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${payment.id}/confirm-cash`)
      .set('Authorization', `Bearer ${orderToken}`)
      .set('x-tenant-id', tenantId);
    return { orderId, paymentId: payment.id, totalMinor, confirmRes };
  }

  it('1. preview shows empty business day with no blockers', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/day-close/preview?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('READY');
    expect(res.body.data.localBusinessDate).toBe(testBusinessDate);
    expect(res.body.data.branchTimezone).toBe('Africa/Addis_Ababa');
    expect(res.body.data.blockers).toHaveLength(0);
    expect(res.body.data.shiftReports).toHaveLength(0);
    expect(res.body.data.openShifts).toHaveLength(0);
  });

  it('2. WAITER cannot preview business day', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/day-close/preview?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(403);
  });

  it('3. MANAGER can preview but not close', async () => {
    const previewRes = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/day-close/preview?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-tenant-id', tenantId);
    expect(previewRes.status).toBe(200);

    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(closeRes.status).toBe(403);
  });

  it('4. owner closes empty business day', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.close).toBeDefined();
    expect(res.body.close.localBusinessDate).toBe(testBusinessDate);
    expect(res.body.close.closedWithException).toBe(false);
    expect(res.body.id).toBeDefined();
  });

  it('5. double close returns 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(res.status).toBe(409);
  });

  it('6. snapshot is immutable after close', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/day-close/current?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(200);
    expect(res.body.data.close.status).toBe('CLOSED');
    expect(res.body.data.snapshot.localBusinessDate).toBe(testBusinessDate);
    expect(res.body.data.snapshot.branchTimezone).toBe('Africa/Addis_Ababa');
    expect(res.body.data.snapshot.closedByUserId).toBeDefined();
  });

  it('7. reopen closed business day', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/reopen?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ reason: 'Need to add missing transactions' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.previousSnapshot).toBeDefined();
    expect(res.body.previousSnapshot.localBusinessDate).toBe(testBusinessDate);
  });

  it('8. reopen requires reason', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/reopen?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ reason: '' });
    expect(res.status).toBe(400);
  });

  it('9. can close again after reopen', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.close).toBeDefined();
    expect(res.body.close.localBusinessDate).toBe(testBusinessDate);
  });

  it('10. open shift blocks normal close', async () => {
    // Open a different business day that's not yet closed
    const futureDate = '2026-08-28';
    // Open a shift for the owner
    const shiftRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ openingCashMinor: '5000' });
    expect(shiftRes.status).toBe(201);

    // Try normal close
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${futureDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(closeRes.status).toBe(409);

    // Close the shift first
    await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/${shiftRes.body.data.id}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ countedCashMinor: '5000', expectedVersion: 1 });
  });

  it('11. close with exception bypasses open-shift blocker', async () => {
    // Open a shift
    const shiftRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/open`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ openingCashMinor: '3000' });
    expect(shiftRes.status).toBe(201);

    const futureDate = '2026-08-29';
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${futureDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ closedWithException: true, reason: 'Emergency close during ongoing shift' });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.close.closedWithException).toBe(true);
    expect(closeRes.body.close.reason).toBe('Emergency close during ongoing shift');

    // Close the shift after
    await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/${shiftRes.body.data.id}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ countedCashMinor: '3000', expectedVersion: 1 });
  });

  it('12. exception close requires reason', async () => {
    const futureDate = '2026-08-30';
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=${futureDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ closedWithException: true, reason: '' });
    expect(closeRes.status).toBe(400);
  });

  it('13. report endpoint returns snapshot data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/day-close/report?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.localBusinessDate).toBe(testBusinessDate);
    expect(res.body.data.branchTimezone).toBe('Africa/Addis_Ababa');
  });

  it('14. cross-tenant isolation returns 404', async () => {
    const tenant2 = await prisma.tenant.create({ data: { name: 'T2', slug: `phase6d-t2-${ts}`, status: 'ACTIVE' } });
    await seedEntitlements(prisma, tenant2.id);
    const branch2 = await prisma.branch.create({ data: { tenantId: tenant2.id, name: 'B2', slug: `phase6d-b2-${ts}`, isActive: true } });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch2.id}/day-close/preview?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(404);
  });

  it('15. WAITER cannot close business day', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/close?localBusinessDate=2026-08-25`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .set('x-tenant-id', tenantId)
      .send({});
    expect(res.status).toBe(403);
  });

  it('16. WAITER cannot reopen business day', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/day-close/reopen?localBusinessDate=${testBusinessDate}`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .set('x-tenant-id', tenantId)
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });
});
