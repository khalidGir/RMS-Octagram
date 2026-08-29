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

async function openShift(app: any, token: string, tenantId: string, branchId: string, openingCashMinor: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/branches/${branchId}/shifts/open`)
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-id', tenantId)
    .send({ openingCashMinor });
}

async function closeShift(app: any, token: string, tenantId: string, branchId: string, shiftId: string, countedCashMinor: string, expectedVersion: number, varianceReason?: string) {
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
    data: { tenantId, branchId, orderId, method: 'CASH', amountMinor: BigInt(totalMinor), currency: 'ETB', status: 'PENDING' },
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

    await prisma.branchMenuItem.create({ data: { tenantId, branchId, menuItemId: item.id, isAvailable: true } });

    const station = await prisma.kitchenStation.create({ data: { tenantId, branchId, name: 'Grill', displayOrder: 0 } });
    await prisma.menuItemStation.create({ data: { tenantId, branchId, menuItemId: item.id, stationId: station.id } });

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
    await prisma.menuItemStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenStation.deleteMany({ where: { tenantId } }).catch(() => {});
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

  it('1. cashier opens a shift with opening cash (string)', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, '10000');
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.openingCashMinor).toBe('10000');
    expect(typeof res.body.data.openingCashMinor).toBe('string');
  });

  it('2. cashier cannot open a second shift (conflict)', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, '5000');
    expect(res.status).toBe(409);
  });

  it('3. get current shift returns the active shift with projection', async () => {
    const res = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.openingCashMinor).toBe('10000');
    expect(res.body.data.approvedCashMinor).toBe('0');
    expect(res.body.data.expectedCashMinor).toBe('10000');
    expect(res.body.data.cashOrderCount).toBe(0);
    expect(res.body.data.cashPaymentCount).toBe(0);
    expect(typeof res.body.data.approvedCashMinor).toBe('string');
    expect(typeof res.body.data.expectedCashMinor).toBe('string');
    expect(typeof res.body.data.cashOrderCount).toBe('number');
    expect(typeof res.body.data.cashPaymentCount).toBe('number');
  });

  it('3b. projection accumulates after cash confirm', async () => {
    const { paymentId } = await createCashPayment(app, ownerToken, tenantId, branchId, variantId);
    const confirm = await confirmCash(app, cashierToken, tenantId, branchId, paymentId);
    expect(confirm.status).toBe(200);
    const res = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(res.status).toBe(200);
    expect(res.body.data.approvedCashMinor).toBe('5000');
    expect(res.body.data.expectedCashMinor).toBe('15000');
    expect(res.body.data.cashOrderCount).toBe(1);
    expect(res.body.data.cashPaymentCount).toBe(1);
  });

  it('3c. projection excludes pending/non-cash payments', async () => {
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
    const orderId = orderRes.body.data.order.id;
    await prisma.payment.create({
      data: { tenantId, branchId, orderId, method: 'CASH', amountMinor: 5000n, currency: 'ETB', status: 'PENDING' },
    });
    await prisma.payment.create({
      data: { tenantId, branchId, orderId, method: 'MOBILE', amountMinor: 3000n, currency: 'ETB', status: 'APPROVED' },
    });
    const res = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(res.body.data.approvedCashMinor).toBe('5000');
    expect(res.body.data.cashPaymentCount).toBe(1);
    expect(res.body.data.expectedCashMinor).toBe('15000');
  });

  it('3d. projection excludes payments attributed to another shift', async () => {
    const otherOpen = await openShift(app, cashier2Token, tenantId, branchId, '1000');
    expect(otherOpen.status).toBe(201);
    const otherShiftId = otherOpen.body.data.id;
    const orderRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
    const orderId = orderRes.body.data.order.id;
    await prisma.payment.create({
      data: { tenantId, branchId, orderId, method: 'CASH', amountMinor: 2000n, currency: 'ETB', status: 'APPROVED', cashierShiftId: otherShiftId },
    });
    const res = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(res.body.data.approvedCashMinor).toBe('5000');
    expect(res.body.data.cashPaymentCount).toBe(1);
    await closeShift(app, cashier2Token, tenantId, branchId, otherShiftId, '3000', 1, 'closing other shift');
  });

  it('3e. projection equals close report when no intervening payment', async () => {
    const pre = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(pre.body.data).not.toBeNull();
    const openApproved = pre.body.data.approvedCashMinor;
    const openExpected = pre.body.data.expectedCashMinor;
    const openOrderCount = pre.body.data.cashOrderCount;
    const close = await closeShift(app, cashierToken, tenantId, branchId, pre.body.data.id, openExpected, 1);
    expect(close.status).toBe(200);
    expect(close.body.report.approvedCashMinor).toBe(openApproved);
    expect(close.body.report.expectedCashMinor).toBe(openExpected);
    expect(close.body.report.orderCount).toBe(openOrderCount);
  });

  it('3f. projection cross-branch isolation', async () => {
    const branch2 = await prisma.branch.create({ data: { tenantId, name: 'Branch Proj', slug: `phase6c-proj-${ts}`, isActive: true } });
    const open = await openShift(app, cashierToken, tenantId, branch2.id, '7000');
    expect(open.status).toBe(201);
    const res = await getCurrentShift(app, cashierToken, tenantId, branch2.id);
    expect(res.body.data.approvedCashMinor).toBe('0');
    expect(res.body.data.expectedCashMinor).toBe('7000');
    await closeShift(app, cashierToken, tenantId, branch2.id, open.body.data.id, '7000', 1);
  });

  it('3g. projection cross-tenant isolation', async () => {
    const tenant2 = await prisma.tenant.create({ data: { name: 'TenantProj', slug: `phase6c-tp-${ts}`, status: 'ACTIVE' } });
    await seedEntitlements(prisma, tenant2.id);
    const br = await prisma.branch.create({ data: { tenantId: tenant2.id, name: 'T2 Branch', slug: `phase6c-tpb-${ts}`, isActive: true } });
    const ow = await prisma.user.create({ data: { email: `phase6c-tp-ow-${ts}@test.com`, passwordHash, displayName: 'T2 Owner', status: 'ACTIVE' } });
    const tm = await prisma.tenantMembership.create({ data: { tenantId: tenant2.id, userId: ow.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId: tenant2.id, branchId: br.id, membershipId: tm.id } });
    const t2token = await login(app, `phase6c-tp-ow-${ts}@test.com`);
    const open = await openShift(app, t2token, tenant2.id, br.id, '8000');
    expect(open.status).toBe(201);
    const res = await getCurrentShift(app, t2token, tenant2.id, br.id);
    expect(res.body.data.approvedCashMinor).toBe('0');
    expect(res.body.data.expectedCashMinor).toBe('8000');
    await closeShift(app, t2token, tenant2.id, br.id, open.body.data.id, '8000', 1);
  });

  it('3h. projection large money above MAX_SAFE_INTEGER', async () => {
    const branch3 = await prisma.branch.create({ data: { tenantId, name: 'Branch Large', slug: `phase6c-lg-${ts}`, isActive: true } });
    const large = '9007199254740993';
    const open = await openShift(app, cashierToken, tenantId, branch3.id, large);
    expect(open.status).toBe(201);
    const res = await getCurrentShift(app, cashierToken, tenantId, branch3.id);
    expect(res.body.data.openingCashMinor).toBe(large);
    expect(res.body.data.expectedCashMinor).toBe(large);
    expect(res.body.data.approvedCashMinor).toBe('0');
    await closeShift(app, cashierToken, tenantId, branch3.id, open.body.data.id, large, 1);
  });

  it('4. owner can open and close a shift', async () => {
    const open = await openShift(app, ownerToken, tenantId, branchId, '20000');
    expect(open.status).toBe(201);
    const close = await closeShift(app, ownerToken, tenantId, branchId, open.body.data.id, '20000', 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
    expect(close.body.shift.varianceMinor).toBe('0');
    expect(close.body.report).toBeDefined();
  });

  it('5. manager can open and close a shift', async () => {
    const open = await openShift(app, managerToken, tenantId, branchId, '15000');
    expect(open.status).toBe(201);
    const close = await closeShift(app, managerToken, tenantId, branchId, open.body.data.id, '15000', 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
  });

  it('6. cash confirmation fails without active shift', async () => {
    const { paymentId } = await createCashPayment(app, ownerToken, tenantId, branchId, variantId);
    const res = await confirmCash(app, cashier2Token, tenantId, branchId, paymentId);
    expect(res.status).toBe(409);
  });

  it('6b. reopen shift for remaining tests', async () => {
    const reopen = await openShift(app, cashierToken, tenantId, branchId, '10000');
    expect(reopen.status).toBe(201);
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
    const close = await closeShift(app, cashierToken, tenantId, branchId, current.body.data.id, '15000', 1);
    expect(close.status).toBe(200);
    expect(close.body.shift.status).toBe('CLOSED');
    expect(close.body.shift.expectedCashMinor).toBe('15000');
    expect(close.body.shift.countedCashMinor).toBe('15000');
    expect(close.body.shift.varianceMinor).toBe('0');
    expect(typeof close.body.shift.expectedCashMinor).toBe('string');
    expect(typeof close.body.shift.countedCashMinor).toBe('string');
    expect(typeof close.body.shift.varianceMinor).toBe('string');
    expect(close.body.report).toBeDefined();
    expect(close.body.report.openingCashMinor).toBe('10000');
    expect(close.body.report.approvedCashMinor).toBe('5000');
    expect(close.body.report.expectedCashMinor).toBe('15000');
    expect(typeof close.body.report.openingCashMinor).toBe('string');
    expect(typeof close.body.report.approvedCashMinor).toBe('string');
    expect(typeof close.body.report.expectedCashMinor).toBe('string');
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
    const open = await openShift(app, cashierToken, tenantId, branchId, '5000');
    expect(open.status).toBe(201);
    const shiftId = open.body.data.id;
    const close = await closeShift(app, cashierToken, tenantId, branchId, shiftId, '6000', 1);
    expect(close.status).toBe(400);
    const close2 = await closeShift(app, cashierToken, tenantId, branchId, shiftId, '5000', 1);
    expect(close2.status).toBe(200);
  });

  it('12. non-zero variance with reason succeeds', async () => {
    const open = await openShift(app, cashierToken, tenantId, branchId, '5000');
    expect(open.status).toBe(201);
    const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '6000', 1, 'Cash register overage');
    expect(close.status).toBe(200);
    expect(close.body.shift.varianceMinor).toBe('1000');
    expect(close.body.shift.varianceReason).toBe('Cash register overage');
  });

  it('13. cannot close an already closed shift', async () => {
    const reports = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/shifts/reports`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
    const shiftId = reports.body.data[0].cashShiftId;
    const close = await closeShift(app, cashierToken, tenantId, branchId, shiftId, '6000', 99);
    expect(close.status).toBe(409);
  });

  it('14. version conflict returns 409', async () => {
    const open = await openShift(app, cashierToken, tenantId, branchId, '3000');
    expect(open.status).toBe(201);
    const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '3000', 99);
    expect(close.status).toBe(409);
    await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '3000', 1);
  });

  it('15. cross-branch shift not visible', async () => {
    const branch2 = await prisma.branch.create({ data: { tenantId, name: 'Branch 2', slug: `phase6c-b2-${ts}`, isActive: true } });
    const open = await openShift(app, cashierToken, tenantId, branch2.id, '0');
    expect(open.status).toBe(201);
    const current1 = await getCurrentShift(app, cashierToken, tenantId, branchId);
    expect(current1.body.data).toBeNull();
    await closeShift(app, cashierToken, tenantId, branch2.id, open.body.data.id, '0', 1);
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
    const open1 = await openShift(app, cashierToken, tenantId, branchId, '1000');
    const open2 = await openShift(app, cashier2Token, tenantId, branchId, '2000');
    expect(open1.status).toBe(201);
    expect(open2.status).toBe(201);
    await closeShift(app, cashierToken, tenantId, branchId, open1.body.data.id, '1000', 1);
    await closeShift(app, cashier2Token, tenantId, branchId, open2.body.data.id, '2000', 1);
  });

  it('18. negative opening cash is rejected', async () => {
    const res = await openShift(app, cashierToken, tenantId, branchId, '-1000');
    expect(res.status).toBe(400);
  });

  // ═══════════════════════════════════════════════════════════════
  // P0 FINANCIAL CONTRACT TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('P0 Financial Contract — Money as strings', () => {
    it('19. rejects decimal input for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, '100.50');
      expect(res.status).toBe(400);
    });

    it('20. rejects exponent notation for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, '1e3');
      expect(res.status).toBe(400);
    });

    it('21. rejects signed input for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, '+1000');
      expect(res.status).toBe(400);
    });

    it('22. rejects leading zeros for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, '007');
      expect(res.status).toBe(400);
    });

    it('23. rejects empty string for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, '');
      expect(res.status).toBe(400);
    });

    it('24. rejects non-numeric string for openingCashMinor', async () => {
      const res = await openShift(app, cashierToken, tenantId, branchId, 'abc');
      expect(res.status).toBe(400);
    });

    it('25. rejects number type for openingCashMinor (must be string)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/shifts/open`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ openingCashMinor: 10000 });
      expect(res.status).toBe(400);
    });

    it('26. rejects decimal input for countedCashMinor on close', async () => {
      const open = await openShift(app, cashierToken, tenantId, branchId, '5000');
      expect(open.status).toBe(201);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '5000.5', 1);
      expect(close.status).toBe(400);
      await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '5000', 1);
    });

    it('27. exact positive variance as strings', async () => {
      const open = await openShift(app, cashierToken, tenantId, branchId, '10000');
      expect(open.status).toBe(201);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '12500', 1, 'Cash register overage');
      expect(close.status).toBe(200);
      expect(close.body.shift.varianceMinor).toBe('2500');
      expect(close.body.report.varianceMinor).toBe('2500');
    });

    it('28. exact negative variance as strings', async () => {
      const open = await openShift(app, cashierToken, tenantId, branchId, '10000');
      expect(open.status).toBe(201);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '7500', 1, 'Cash register shortage');
      expect(close.status).toBe(200);
      expect(close.body.shift.varianceMinor).toBe('-2500');
      expect(close.body.report.varianceMinor).toBe('-2500');
    });

    it('29. zero variance returns "0" string', async () => {
      const open = await openShift(app, cashierToken, tenantId, branchId, '10000');
      expect(open.status).toBe(201);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '10000', 1);
      expect(close.status).toBe(200);
      expect(close.body.shift.varianceMinor).toBe('0');
      expect(typeof close.body.shift.varianceMinor).toBe('string');
    });

    it('30. large money value (above MAX_SAFE_INTEGER) as string', async () => {
      const largeValue = '9007199254740993'; // MAX_SAFE_INTEGER + 2
      const open = await openShift(app, cashierToken, tenantId, branchId, largeValue);
      expect(open.status).toBe(201);
      expect(open.body.data.openingCashMinor).toBe(largeValue);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, largeValue, 1);
      expect(close.status).toBe(200);
      expect(close.body.shift.expectedCashMinor).toBe(largeValue);
      expect(close.body.shift.countedCashMinor).toBe(largeValue);
      expect(close.body.shift.varianceMinor).toBe('0');
    });

    it('31. report snapshot serializes money as strings for immutable report', async () => {
      const open = await openShift(app, cashierToken, tenantId, branchId, '8000');
      expect(open.status).toBe(201);
      const close = await closeShift(app, cashierToken, tenantId, branchId, open.body.data.id, '8000', 1);
      expect(close.status).toBe(200);
      const report = close.body.report;
      expect(typeof report.openingCashMinor).toBe('string');
      expect(typeof report.approvedCashMinor).toBe('string');
      expect(typeof report.expectedCashMinor).toBe('string');
      expect(typeof report.countedCashMinor).toBe('string');
      expect(typeof report.varianceMinor).toBe('string');
    });
  });
});
