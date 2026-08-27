import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { ProofStorage } from '../src/modules/payments/proof-storage.interface';
import { InMemoryProofStorage } from '../src/modules/payments/in-memory-proof-storage';
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

describe('Public Tracking Response — End-to-End (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;
  let tableId: string;
  let passwordHash: string;

  const ownerEmail = `track-ow-${ts}@test.com`;
  const cashierEmail = `track-ca-${ts}@test.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProofStorage)
      .useClass(InMemoryProofStorage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const outboxProcessor = app.get(OutboxProcessor);
    outboxProcessor.stop();
    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({
      data: { name: `TrackResp_${ts}`, slug: `track-resp-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main Branch', slug: `track-main-${ts}`, timezone: 'Africa/Addis_Ababa', isActive: true },
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
        basePriceMinor: 10000n,
        sku: `TRV-${ts}`,
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

    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });

    const cashier = await prisma.user.create({
      data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' },
    });
    const cm = await prisma.tenantMembership.create({
      data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });

    ownerToken = await login(app, ownerEmail);
    cashierToken = await login(app, cashierEmail);

    await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/shifts/open`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-tenant-id', tenantId)
      .send({ openingCashMinor: 50000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.paymentProof.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.paymentInstruction.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.kitchenStation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchMenuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.restaurantTable.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, cashierEmail] } } }).catch(() => {});
    await prisma.branchOrderCounter.deleteMany({ where: { branchId } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
  });

  async function createOrderViaApi(orderType: string, extra: Record<string, any> = {}) {
    const crypto = await import('crypto');
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

    const data: Record<string, any> = {
      tenantId, branchId, orderNumber: BigInt(Date.now()),
      orderType, status: 'PENDING_PAYMENT',
      currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
      source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
      ...extra,
    };
    if (orderType === 'DINE_IN') {
      data.tableId = tableId;
      data.diningSessionId = extra.diningSessionId;
    }

    const order = await prisma.order.create({ data });
    return { order, raw, hash };
  }

  async function createPayment(method: string, orderId: string, status = 'PENDING_VERIFICATION', reviewNote?: string) {
    const shift = await prisma.cashShift.findFirst({
      where: { tenantId, branchId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId, branchId, orderId, method, status,
        amountMinor: 10000n, currency: 'ETB',
        cashierShiftId: shift?.id,
        reviewNote: reviewNote,
      },
    });
    return payment;
  }

  // ─── 1. CASH PAYMENT ───────────────────────────────

  describe('Cash payment tracking', () => {
    let rawToken: string;

    beforeAll(async () => {
      const { order: o, raw } = await createOrderViaApi('POS');
      rawToken = raw;
      await createPayment('CASH', o.id, 'APPROVED');
    });

    it('returns payment.method=CASH and payment.status=APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment).toBeDefined();
      expect(res.body.data.payment.method).toBe('CASH');
      expect(res.body.data.payment.status).toBe('APPROVED');
    });
  });

  // ─── 2. BANK TRANSFER (CBE) ────────────────────────

  describe('Bank transfer tracking', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('cbe-tok').digest('hex');
      const o = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 1),
          orderType: 'POS', status: 'PENDING_PAYMENT',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      await createPayment('CBE', o.id, 'PENDING_VERIFICATION');
      rawToken = 'cbe-tok';
    });

    it('returns payment.method=CBE and payment.status=PENDING_VERIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment).toBeDefined();
      expect(res.body.data.payment.method).toBe('CBE');
      expect(res.body.data.payment.status).toBe('PENDING_VERIFICATION');
    });
  });

  // ─── 3. TELEBIRR ───────────────────────────────────

  describe('Telebirr tracking', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('tele-tok').digest('hex');
      const o = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 2),
          orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      await createPayment('TELEBIRR', o.id, 'APPROVED');
      rawToken = 'tele-tok';
    });

    it('returns payment.method=TELEBIRR and payment.status=APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment).toBeDefined();
      expect(res.body.data.payment.method).toBe('TELEBIRR');
      expect(res.body.data.payment.status).toBe('APPROVED');
    });
  });

  // ─── 4. DINE-IN TABLE LABEL ────────────────────────

  describe('Dine-in tracking shows tableLabel', () => {
    let rawToken: string;

    beforeAll(async () => {
      const ds = await prisma.diningSession.create({
        data: {
          tenantId, branchId, tableId, status: 'OPEN', guestCount: 2,
        },
      });
      const hash = (await import('crypto')).createHash('sha256').update('dine-tok').digest('hex');
      await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 3),
          orderType: 'DINE_IN', status: 'CONFIRMED',
          tableId, diningSessionId: ds.id,
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      rawToken = 'dine-tok';
    });

    it('returns tableLabel="T1" for DINE_IN order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderType).toBe('DINE_IN');
      expect(res.body.data.tableLabel).toBe('T1');
    });
  });

  // ─── 5. TAKEAWAY TABLE LABEL NULL ──────────────────

  describe('Takeaway tracking shows null tableLabel', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('take-tok').digest('hex');
      await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 4),
          orderType: 'TAKEAWAY', status: 'CONFIRMED',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      rawToken = 'take-tok';
    });

    it('returns tableLabel=null for TAKEAWAY order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderType).toBe('TAKEAWAY');
      expect(res.body.data.tableLabel).toBeNull();
    });
  });

  // ─── 6. PICKUP TABLE LABEL NULL ────────────────────

  describe('Pickup tracking shows null tableLabel', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('pick-tok').digest('hex');
      await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 5),
          orderType: 'PICKUP', status: 'CONFIRMED',
          customerName: 'Test', customerPhone: '+251900000000', pickupAt: new Date(),
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      rawToken = 'pick-tok';
    });

    it('returns tableLabel=null for PICKUP order', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderType).toBe('PICKUP');
      expect(res.body.data.tableLabel).toBeNull();
    });
  });

  // ─── 7. REJECTED PAYMENT ───────────────────────────

  describe('Rejected payment shows method and status, no reviewNote', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('rej-tok').digest('hex');
      const o = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 6),
          orderType: 'POS', status: 'PENDING_PAYMENT',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      await createPayment('CBE', o.id, 'REJECTED', 'Suspicious transfer reference');
      rawToken = 'rej-tok';
    });

    it('returns payment.status=REJECTED but no rejectionReason', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment).toBeDefined();
      expect(res.body.data.payment.method).toBe('CBE');
      expect(res.body.data.payment.status).toBe('REJECTED');
      expect(res.body.data.payment.rejectionReason).toBeUndefined();
    });
  });

  // ─── 8. NO PAYMENT YET ─────────────────────────────

  describe('Order with no payment', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('nopay-tok').digest('hex');
      await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 7),
          orderType: 'POS', status: 'DRAFT',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      rawToken = 'nopay-tok';
    });

    it('returns payment=null when no payment exists', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment).toBeNull();
    });
  });

  // ─── 9. NEW RESPONSE FIELDS ────────────────────────

  describe('New fields present in response', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('fields-tok').digest('hex');
      await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 8),
          orderType: 'POS', status: 'CONFIRMED',
          currency: 'ETB', subtotalMinor: 10000n, discountMinor: 0n,
          taxMinor: 1500n, totalMinor: 11500n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      rawToken = 'fields-tok';
    });

    it('includes orderType, branchName, subtotalMinor, discountMinor, taxMinor', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.orderType).toBe('POS');
      expect(d.branchName).toBe('Main Branch');
      expect(d.subtotalMinor).toBe('10000');
      expect(d.discountMinor).toBe('0');
      expect(d.taxMinor).toBe('1500');
      expect(d.totalMinor).toBe('11500');
      expect(typeof d.subtotalMinor).toBe('string');
      expect(typeof d.taxMinor).toBe('string');
    });
  });

  // ─── 10. INVALID TOKEN ─────────────────────────────

  describe('Invalid token', () => {
    it('returns 404 for non-existent token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/orders/0000000000000000000000000000000000000000000000000000000000000000');
      expect(res.status).toBe(404);
      expect(res.body.message).toBeDefined();
    });

    it('returns 404 for garbage token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/orders/not-a-real-token');
      expect(res.status).toBe(404);
    });
  });

  // ─── 11. PAYMENT OBJECT CONTAINS ONLY METHOD AND STATUS ─

  describe('Payment object contains only method and status', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('app-tok').digest('hex');
      const o = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 9),
          orderType: 'POS', status: 'CONFIRMED',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      await createPayment('CASH', o.id, 'APPROVED');
      rawToken = 'app-tok';
    });

    it('payment has only method and status, no extra keys', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      const p = res.body.data.payment;
      expect(p.status).toBe('APPROVED');
      expect(p.method).toBe('CASH');
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['method', 'status']));
      expect(Object.keys(p).length).toBe(2);
    });
  });

  // ─── 12. PRIVACY: INTERNAL DATA ABSENT ─────────────

  describe('Privacy — internal data never exposed', () => {
    let rawToken: string;

    beforeAll(async () => {
      const hash = (await import('crypto')).createHash('sha256').update('priv-tok').digest('hex');
      const o = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: BigInt(Date.now() + 10),
          orderType: 'POS', status: 'PENDING_PAYMENT',
          currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n,
          source: 'CUSTOMER_WEB', trackingTokenHash: hash, version: 1,
        },
      });
      await createPayment('CBE', o.id, 'REJECTED', 'Private internal staff note');
      rawToken = 'priv-tok';
    });

    it('does not expose internal order id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBeUndefined();
    });

    it('does not expose reviewNote as rejectionReason or any field', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payment.rejectionReason).toBeUndefined();
      expect(JSON.stringify(res.body.data)).not.toContain('Suspicious transfer reference');
    });

    it('does not expose customerPhone', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customerPhone).toBeUndefined();
    });

    it('does not expose tenantId, branchId, tableId, or diningSessionId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.tenantId).toBeUndefined();
      expect(d.branchId).toBeUndefined();
      expect(d.tableId).toBeUndefined();
      expect(d.diningSessionId).toBeUndefined();
    });

    it('does not expose createdByUserId, reviewedByUserId, or staff identities', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      const s = JSON.stringify(res.body.data);
      expect(s).not.toContain('createdByUserId');
      expect(s).not.toContain('reviewedByUserId');
      expect(s).not.toContain('userId');
    });

    it('does not expose payment proof metadata, providerReference, or accountIdentifier', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      const s = JSON.stringify(res.body.data);
      expect(s).not.toContain('providerReference');
      expect(s).not.toContain('paymentTokenHash');
      expect(s).not.toContain('accountIdentifier');
      expect(s).not.toContain('mediaObjectId');
    });

    it('does not expose trackingTokenHash', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${rawToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.trackingTokenHash).toBeUndefined();
    });
  });
});
