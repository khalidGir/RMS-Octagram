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

async function openShift(app: any, token: string, tenantId: string, branchId: string, openingCashMinor: number) {
  return request(app.getHttpServer())
    .post(`/api/v1/branches/${branchId}/shifts/open`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId)
    .send({ openingCashMinor });
}

async function closeShift(app: any, token: string, tenantId: string, branchId: string, shiftId: string, countedCashMinor: number, expectedVersion: number, varianceReason?: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/branches/${branchId}/shifts/${shiftId}/close`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId)
    .send({ countedCashMinor, expectedVersion, varianceReason });
}

async function getCurrentShift(app: any, token: string, tenantId: string, branchId: string) {
  return request(app.getHttpServer())
    .get(`/api/v1/branches/${branchId}/shifts/current`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId);
}

async function createCashPayment(app: any, token: string, tenantId: string, branchId: string, variantId: string) {
  const orderRes = await request(app.getHttpServer())
    .post(`/api/v1/branches/${branchId}/orders`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId)
    .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
  if (orderRes.status !== 201) throw new Error(`Order creation failed: ${JSON.stringify(orderRes.body)}`);
  const orderId = orderRes.body.data.order.id;
  const totalMinor = orderRes.body.data.order.totalMinor;
  const payment = await prisma.payment.create({
    data: { tenantId, branchId, orderId, method: 'CASH', amountMinor: totalMinor, currency: 'ETB', status: 'PENDING' },
  });
  return { orderId, paymentId: payment.id, totalMinor };
}

async function confirmCash(app: any, token: string, tenantId: string, branchId: string, paymentId: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/branches/${branchId}/payments/${paymentId}/confirm-cash`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId);
}

describe('Phase 6C — Cashier Shifts (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let cashierToken: string;
  let cashier2Token: string;
  let managerToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;

  const ownerEmail = `phase6c-owner-${ts}@test.com`;
  const cashierEmail = `phase6c-cashier-${ts}@test.com`;
  const cashier2Email = `phase6c-cashier2-${ts}@test.com`;
  const managerEmail = `phase6c-manager-${ts}@test.com`;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: 'Phase6CTest', slug: `phase6c-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({ data: { tenantId, name: 'Main Branch', slug: `phase6c-main-${ts}`, isActive: true } });
    branchId = branch.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    const cashier = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });
    cashierToken = await login(app, cashierEmail);

    const cashier2 = await prisma.user.create({ data: { email: cashier2Email, passwordHash, displayName: 'Cashier2', status: 'ACTIVE' } });
    const cm2 = await prisma.tenantMembership.create({ data: { tenantId, userId: cashier2.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm2.id } });
    cashier2Token = await login(app, cashier2Email);

    const manager = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });
    managerToken = await login(app, managerEmail);

    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 0, isActive: true } });
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true } });
    const variant = await prisma.menuItemVariant.create({ data: { tenantId, name: 'Regular', sku: 'BURG-6C', basePriceMinor: 5000n, isActive: true, isDefault: true, menuItem: { connect: { id: item.id } } } });
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
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, cashierEmail, cashier2Email, managerEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. cashier opens a shift with opening cash', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, 10000);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.openingCashMinor).toBe(10000);
  });

  it('2. cashier cannot open a second shift (conflict)', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, 5000);
    expect(res.status).toBe(409);
  });

  it('3. get current shift returns the active shift', async () => {
    const res = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.status).toBe('OPEN');
  });

  it('4. owner can open and close a shift', async () => {
    const open = await openShift(app, ownerToken, tenantId, branchId, 20000);
    expect(open.status).toBe(201);
    const close = await closeShift(app, ownerToken, tenantId, branchId, open.body.data.id, 20000, 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
    expect(close.body.shift.varianceMinor).toBe(0);
    expect(close.body.report).toBeDefined();
  });

  it('5. manager can open and close a shift', async () => {
    const open = await openShift(app, managerToken, tenantId, branchId, 15000);
    expect(open.status).toBe(201);
    const close = await closeShift(app, managerToken, tenantId, branchId, open.body.data.id, 15000, 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
  });

  it('6. cash confirmation fails without active shift', async () => {
    const { paymentId } = await createCashPayment(app, ownerToken, tenantId, branchId, variantId);
    const res = await confirmCash(app, cashier2Token, tenantId, branchId, paymentId);
    expect(res.status).toBe(409);
  });

  it('7. cash confirmation succeeds with active shift and attributes payment', async () => {
    const { paymentId } = await createCashPayment(app, ownerToken, tenantId, branchId, variantId);
    const res = await confirmCash(app, cashierToken, tenantId, branchId, paymentId);
    expect(res.status).toBe(200);
    const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(updatedPayment!.cashierShiftId).not.toBeNull();
  });

  it('8. cashier closes shift with zero variance (opening 10000 + 5000 payment = 15000 expected)', async () => {
    const current = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(current.body.data).not.toBeNull();
    const close = await closeShift(app, cashierToken, tenantId, branchId, current.body.data.id, 15000, 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
    expect(close.body.shift.expectedCashMinor).toBe(15000);
    expect(close.body.shift.countedCashMinor).toBe(15000);
    expect(close.body.shift.varianceMinor).toBe(0);
    expect(close.body.report).toBeDefined();
    expect(close.body.report.openingCashMinor).toBe(10000);
    expect(close.body.report.approvedCashMinor).toBe(5000);
    expect(close.body.report.expectedCashMinor).toBe(15000);
  });

  it('9. current shift is null after close', async () => {
    const current = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(current.body.data).toBeNull();
  });

  it('10. shift reports list shows closed shifts', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/shifts/reports`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('11. non-zero variance requires reason', async () => {
    const open = await openShift(app, cashierToken, tenantId, branchId, 5000);
    expect(open.status).toBe(201);
    const shiftId = open.body.data.id;
    const close = await closeShift(app, cashierToken, tenantId, branchId, shiftId, 6000, 1);
    expect(close.status).toBe(400);
    const close2 = await closeShift(app, cashierToken, tenantId, branchId, shiftId, 5000, 1);
    expect(close2.status).toBe(200);
  });

  it('12. non-zero variance with reason succeeds', async () => {
    const open = await openShift(app, cashierToken, tenantId, branchId, 5000);
    expect(open.status).toBe(201);
    const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, 6000, 1, 'Cash register overage');
    expect(close.status).toBe(200);
    expect(close.body.shift.varianceMinor).toBe(1000);
    expect(close.body.shift.varianceReason).toBe('Cash register overage');
  });

  it('13. cannot close an already closed shift', async () => {
    const reports = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/shifts/reports`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    const shiftId = reports.body.data[0].cashShiftId;
    const close = await closeShift(app, cashierToken, tenantId, branchId, shiftId, 6000, 99);
    expect(close.status).toBe(409);
  });

  it('14. version conflict returns 409', async () => {
    const open = await openShift(app, cashierToken, tenantId, branchId, 3000);
    expect(open.status).toBe(201);
    const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, 3000, 99);
    expect(close.status).toBe(409);
    // Clean up
    await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, 3000, 1);
  });

  it('15. cross-branch shift not visible', async () => {
    const branch2 = await prisma.branch.create({ data: { tenantId, name: 'Branch 2', slug: `phase6c-b2-${ts}`, isActive: true } });
    const open = await openShift(app, cashierToken, tenantId, branch2.id, 0);
    expect(open.status).toBe(201);
    const current1 = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(current1.body.data).toBeNull();
    await closeShift(app, cashierToken, tenantId, branch2.id, open.body.data.id, 0, 1);
  });

  it('16. cross-tenant shift not accessible', async () => {
    const tenant2 = await prisma.tenant.create({ data: { name: 'Tenant2', slug: `phase6c-t2-${ts}`, status: 'ACTIVE' } });
    await seedEntitlements(prisma, tenant2.id);
    const branch2t = await prisma.branch.create({ data: { tenantId: tenant2.id, name: 'Branch T2', slug: `phase6c-t2b-${ts}`, isActive: true } });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch2t.id}/shifts/reports`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('17. two different cashiers can each have one open shift', async () => {
    const open1 = await openShift(app, cashierToken, tenantId, branchId, 1000);
    const open2 = await openShift(app, cashier2Token, tenantId, branchId, 2000);
    expect(open1.status).toBe(201);
    expect(open2.status).toBe(201);
    await closeShift(app, cashierToken, tenantId, branchId, open1.body.data.id, 1000, 1);
    await closeShift(app, cashier2Token, tenantId, branchId, open2.body.data.id, 2000, 1);
  });

  it('18. negative opening cash is rejected', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, -1000);
    expect(res.status).toBe(400);
  });
});
