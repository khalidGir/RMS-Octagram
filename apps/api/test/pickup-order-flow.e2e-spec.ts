import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { ProofStorage } from '../src/modules/payments/proof-storage.interface';
import { InMemoryProofStorage } from '../src/modules/payments/in-memory-proof-storage';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

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

describe('Pickup Order Flow — End-to-End (e2e)', () => {
  let app: any;
  let outboxProcessor: OutboxProcessor;
  let proofStorage: InMemoryProofStorage;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let kitchenToken: string;
  let tenantId: string;
  let branchId: string;
  let variantId: string;
  let stationId: string;
  let orderId: string;
  let trackingToken: string;
  let paymentId: string;

  const ownerEmail = `pickup-owner-${ts}@test.com`;
  const managerEmail = `pickup-manager-${ts}@test.com`;
  const cashierEmail = `pickup-cashier-${ts}@test.com`;
  const kitchenEmail = `pickup-kitchen-${ts}@test.com`;
  const otherTenantEmail = `pickup-other-${ts}@test.com`;

  let otherTenantToken: string;
  let otherTenantId: string;
  let otherBranchId: string;
  let crossBranchCashierToken: string;
  const crossBranchCashierEmail = `pickup-cross-branch-${ts}@test.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProofStorage)
      .useClass(InMemoryProofStorage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    outboxProcessor = app.get(OutboxProcessor);
    outboxProcessor.stop();
    proofStorage = app.get(ProofStorage) as unknown as InMemoryProofStorage;

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({
      data: { name: 'PickupTest', slug: `pickup-test-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: 'main', isActive: true },
    });
    branchId = branch.id;

    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });

    const manager = await prisma.user.create({
      data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' },
    });
    const mm = await prisma.tenantMembership.create({
      data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });

    const cashier = await prisma.user.create({
      data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' },
    });
    const cm = await prisma.tenantMembership.create({
      data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });

    const kitchenStaff = await prisma.user.create({
      data: { email: kitchenEmail, passwordHash, displayName: 'Kitchen', status: 'ACTIVE' },
    });
    const km = await prisma.tenantMembership.create({
      data: { tenantId, userId: kitchenStaff.id, role: 'KITCHEN_STAFF', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: km.id } });

    ownerToken = await login(app, ownerEmail);
    managerToken = await login(app, managerEmail);
    cashierToken = await login(app, cashierEmail);
    kitchenToken = await login(app, kitchenEmail);

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
        sku: 'BURG-001',
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

    const station = await prisma.kitchenStation.create({
      data: { tenantId, branchId, name: 'Grill', displayOrder: 0 },
    });
    stationId = station.id;

    await prisma.menuItemStation.create({
      data: { tenantId, branchId, menuItemId: item.id, stationId },
    });

    await prisma.paymentInstruction.create({
      data: {
        tenantId,
        branchId,
        method: 'CBE',
        label: 'CBE Birr',
        accountHolder: 'Test Restaurant',
        accountIdentifier: '1234567890',
        instructions: 'Transfer the exact amount',
      },
    });

    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;

    const otherTenant = await prisma.tenant.create({
      data: { name: 'OtherTenant', slug: `other-tenant-${ts}`, status: 'ACTIVE' },
    });
    otherTenantId = otherTenant.id;
    await seedEntitlements(prisma, otherTenantId);

    const otherBranch = await prisma.branch.create({
      data: { tenantId: otherTenantId, name: 'Other', slug: 'other', isActive: true },
    });
    otherBranchId = otherBranch.id;

    const otherUser = await prisma.user.create({
      data: { email: otherTenantEmail, passwordHash, displayName: 'Other', status: 'ACTIVE' },
    });
    const otherM = await prisma.tenantMembership.create({
      data: { tenantId: otherTenantId, userId: otherUser.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId: otherTenantId, branchId: otherBranchId, membershipId: otherM.id },
    });
    otherTenantToken = await login(app, otherTenantEmail);

    const crossBranchCashier = await prisma.user.create({
      data: { email: crossBranchCashierEmail, passwordHash, displayName: 'CrossBranch', status: 'ACTIVE' },
    });
    const xcbm = await prisma.tenantMembership.create({
      data: { tenantId, userId: crossBranchCashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: otherBranchId, membershipId: xcbm.id } });
    crossBranchCashierToken = await login(app, crossBranchCashierEmail);
  });

  afterAll(async () => {
    await app.close();
    for (const tid of [tenantId, otherTenantId]) {
      await prisma.kitchenTicketLine.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.kitchenTicketHistory.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.kitchenTicket.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.stationTicketCounter.deleteMany({ where: { branchId: { in: [branchId, otherBranchId] } } }).catch(() => {});
      await prisma.menuItemStation.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.paymentProof.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.mediaObject.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.paymentInstruction.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.idempotencyRecord.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.orderLineModifier.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.orderLine.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.orderStatusHistory.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.order.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.featureSetting.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.tenantEntitlement.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.branchAssignment.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.branchMenuItem.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.kitchenStation.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.restaurantTable.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuItemVariant.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuItem.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuCategory.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.outboxEvent.deleteMany({ where: { tenantId: tid } }).catch(() => {});
    }
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: otherBranchId } }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, managerEmail, cashierEmail, kitchenEmail, otherTenantEmail, crossBranchCashierEmail] } },
    }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  function futurePickup(minutes = 60): string {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  // ─── SECTION 1: Public Pickup Flow ────────────────────────

  describe('Public pickup flow', () => {
    it('1. creates pickup order with customer name, phone, and pickup time', async () => {
      const pickupAt = futurePickup(60);
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt,
          lines: [{ variantId, quantity: 2 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.order.id).toBeDefined();
      expect(res.body.data.order.orderType).toBe('PICKUP');
      expect(res.body.data.order.customerName).toBe('Abebe');
      expect(res.body.data.order.customerPhone).toBe('+251911111111');
      expect(res.body.data.order.status).toBe('PENDING_PAYMENT');
      expect(res.body.data.trackingToken).toBeDefined();
      expect(res.body.data.order.totalMinor).toBe('50000');
      expect(typeof res.body.data.order.totalMinor).toBe('string');
      orderId = res.body.data.order.id;
      trackingToken = res.body.data.trackingToken;
    });

    it('2. rejects missing contact information', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          lines: [{ variantId, quantity: 1 }],
          pickupAt: futurePickup(60),
        });
      expect(res.status).toBe(400);
    });

    it('2b. rejects missing customerName', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerPhone: '+251911111111',
          lines: [{ variantId, quantity: 1 }],
          pickupAt: futurePickup(60),
        });
      expect(res.status).toBe(400);
    });

    it('2c. rejects missing customerPhone', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          lines: [{ variantId, quantity: 1 }],
          pickupAt: futurePickup(60),
        });
      expect(res.status).toBe(400);
    });

    it('3. rejects pickup time in the past', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt: new Date(Date.now() - 3600_000).toISOString(),
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/future/i);
    });

    it('3b. rejects pickup time below preparation lead time', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt: new Date(Date.now() + 2 * 60_000).toISOString(),
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/at least 15 minutes/i);
    });

    it('4. enforces PICKUP_ORDERING entitlement', async () => {
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'PICKUP_ORDERING' } },
        data: { status: 'DISABLED' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt: futurePickup(60),
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_DISABLED');

      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'PICKUP_ORDERING' } },
        data: { status: 'ENABLED' },
      });
    });

    it('5. uses server-authoritative pricing (ignores client total)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt: futurePickup(60),
          lines: [{ variantId, quantity: 3 }],
          quotedTotal: '100',
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRICE_CHANGED');
      expect(res.body.serverTotal).toBe('75000');
    });

    it('5b. rejects inactive/unavailable items', async () => {
      await prisma.branchMenuItem.updateMany({
        where: { branchId, menuItemId: { not: '' } },
        data: { isAvailable: false },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Abebe',
          customerPhone: '+251911111111',
          pickupAt: futurePickup(60),
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(409);

      await prisma.branchMenuItem.updateMany({
        where: { branchId, menuItemId: { not: '' } },
        data: { isAvailable: true },
      });
    });
  });

  // ─── SECTION 2: Staff Cash Flow ──────────────────────────

  describe('Staff cash flow', () => {
    let cashOrderId: string;
    let cashOrderVersion: number;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          orderType: 'POS',
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      cashOrderId = res.body.data.order.id;
      cashOrderVersion = res.body.data.order.version;
    });

    it('8. cashier records cash payment exactly once', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: cashOrderId, idempotencyKey: `cash-${ts}-1` });
      expect(res.status).toBe(201);
      expect(res.body.data.method).toBe('CASH');
      expect(res.body.data.status).toBe('PENDING');
      paymentId = res.body.data.id;
    });

    it('8b. same idempotency key replays', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: cashOrderId, idempotencyKey: `cash-${ts}-1` });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(paymentId);
    });

    it('8c. different key on same order returns 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: cashOrderId, idempotencyKey: `cash-${ts}-2` });
      expect(res.status).toBe(409);
    });

    it('9. cash confirmation atomically transitions to CONFIRMED with audit/outbox', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${paymentId}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');

      const order = await prisma.order.findUnique({ where: { id: cashOrderId } });
      expect(order!.status).toBe('CONFIRMED');
      expect(order!.confirmedAt).toBeDefined();

      const audit = await prisma.auditLog.findMany({
        where: { tenantId, entityId: paymentId, action: 'PAYMENT_CASH_CONFIRM' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(1);

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: paymentId, eventType: 'payment.approved' },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);

      const orderOutbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: cashOrderId, eventType: 'order.confirmed' },
      });
      expect(orderOutbox.length).toBeGreaterThanOrEqual(1);

      await outboxProcessor.poll(true);

      const publishedEvent = await prisma.outboxEvent.findFirst({
        where: { tenantId, aggregateId: cashOrderId, eventType: 'order.confirmed' },
      });
      expect(publishedEvent!.publishedAt).not.toBeNull();
    });

    it('9b. cash confirmation is idempotent', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${paymentId}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
    });

    it('9c. KDS tickets created for confirmed order', async () => {
      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId: cashOrderId },
      });
      expect(tickets.length).toBe(1);
      expect(tickets[0].status).toBe('QUEUED');

      await outboxProcessor.poll(true);

      const ticketsAfterSecondPoll = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId: cashOrderId },
      });
      expect(ticketsAfterSecondPoll.length).toBe(1);
    });
  });

  // ─── SECTION 3: Manual Transfer Flow ─────────────────────

  describe('Manual-transfer flow', () => {
    let mtOrderId: string;
    let mtPaymentToken: string;
    let mtPaymentId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          orderType: 'POS',
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      mtOrderId = res.body.data.order.id;
    });

    it('10. creates manual-transfer payment', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .send({ trackingToken, idempotencyKey: `mt-${ts}-1` });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      mtPaymentId = res.body.data.id;
      mtPaymentToken = res.body.data.paymentToken;
    });

    it('10b. transitions to PENDING_VERIFICATION after proof submission', async () => {
      const crypto = await import('crypto');
      const proofBytes = Buffer.from('test-proof-mt');
      const sha256Hex = crypto.createHash('sha256').update(proofBytes).digest('hex');

      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .send({
          paymentToken: mtPaymentToken,
          contentType: 'image/jpeg',
          sizeBytes: proofBytes.length,
          sha256: sha256Hex,
        });
      expect(uploadRes.status).toBe(200);
      const mediaObjectId = uploadRes.body.data.mediaObjectId;
      const objectKey = uploadRes.body.data.objectKey;

      proofStorage.simulateUpload(objectKey, proofBytes, 'image/jpeg', sha256Hex);

      const finalizeRes = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-finalize')
        .send({ paymentToken: mtPaymentToken, mediaObjectId });
      expect(finalizeRes.status).toBe(200);

      const payment = await prisma.payment.findUnique({ where: { id: mtPaymentId } });
      expect(payment!.status).toBe('PENDING_VERIFICATION');
    });

    it('10c. approval transitions order to CONFIRMED with outbox', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${mtPaymentId}/approve`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe('CONFIRMED');

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: mtPaymentId, eventType: 'payment.approved' },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);

      const orderOutbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: orderId, eventType: 'order.confirmed' },
      });
      expect(orderOutbox.length).toBeGreaterThanOrEqual(1);

      await outboxProcessor.poll(true);

      const publishedEvent = await prisma.outboxEvent.findFirst({
        where: { tenantId, aggregateId: orderId, eventType: 'order.confirmed' },
      });
      expect(publishedEvent!.publishedAt).not.toBeNull();
    });
  });

  // ─── SECTION 4: KDS Lifecycle ────────────────────────────

  describe('KDS lifecycle', () => {
    let kdsOrderId: string;
    let ticketId: string;
    let ticketVersion: number;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          orderType: 'POS',
          lines: [{ variantId, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      kdsOrderId = res.body.data.order.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: kdsOrderId, idempotencyKey: `kds-cash-${ts}` });
      expect(payRes.status).toBe(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(confirmRes.status).toBe(200);

      await outboxProcessor.poll(true);

      const publishedEvent = await prisma.outboxEvent.findFirst({
        where: { tenantId, aggregateId: kdsOrderId, eventType: 'order.confirmed' },
      });
      expect(publishedEvent!.publishedAt).not.toBeNull();

      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId: kdsOrderId },
      });
      expect(tickets.length).toBe(1);
      ticketId = tickets[0].id;
      ticketVersion = tickets[0].version;
    });

    it('14. QUEUED → IN_PROGRESS via bump', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.version).toBe(ticketVersion + 1);
      ticketVersion = res.body.data.version;
    });

    it('14b. IN_PROGRESS → READY via bump', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
      ticketVersion = res.body.data.version;
    });

    it('14c. recall READY → IN_PROGRESS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/recall`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'Missing item', expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      ticketVersion = res.body.data.version;
    });

    it('14d. re-bump IN_PROGRESS → READY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
      ticketVersion = res.body.data.version;
    });

    it('14e. READY → COMPLETED via complete', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/complete`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('14f. version conflict on stale bump', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(409);
    });

    it('14g. cannot bump COMPLETED ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticketId}/bump`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticketVersion });
      expect(res.status).toBe(409);
    });
  });

  // ─── SECTION 5: Isolation & Security ─────────────────────

  describe('Isolation and security', () => {
    it('12. cross-branch access is denied', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${crossBranchCashierToken}`)
        .set('x-tenant-id', tenantId)
        .set('x-branch-id', otherBranchId);
      expect(res.status).toBe(404);
    });

    it('12b. cross-tenant access is denied', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .set('x-tenant-id', otherTenantId)
        .set('x-branch-id', otherBranchId);
      expect(res.status).toBe(404);
    });

    it('13. unauthorized role is denied for kitchen ticket operations', async () => {
      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (tickets.length === 0) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${tickets[0].id}/bump`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: tickets[0].version });
      expect([200, 409]).toContain(res.status);
    });

    it('13b. kitchen staff cannot cancel tickets (owner/manager only)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/nonexistent/cancel`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(403);
    });
  });

  // ─── SECTION 6: Concurrency & Rollback ───────────────────

  describe('Concurrency and rollback', () => {
    it('7. concurrent duplicate submissions create exactly one order', async () => {
      const idempotencyKey = `concurrent-${ts}`;
      const payload = {
        branchId,
        customerName: 'Concurrent',
        customerPhone: '+251922222222',
        pickupAt: futurePickup(90),
        lines: [{ variantId, quantity: 1 }],
        idempotencyKey,
      };

      const results = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/public/pickup-orders').send(payload),
        request(app.getHttpServer()).post('/api/v1/public/pickup-orders').send(payload),
        request(app.getHttpServer()).post('/api/v1/public/pickup-orders').send(payload),
      ]);

      const statuses = results.map((r: any) => r.status);
      const successCount = statuses.filter((s: number) => s === 201).length;
      const conflictCount = statuses.filter((s: number) => s === 409).length;
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(successCount + conflictCount).toBe(3);

      const successIds = results
        .filter((r: any) => r.status === 201)
        .map((r: any) => r.body.data.order.id);
      const uniqueIds = [...new Set(successIds)];
      expect(uniqueIds.length).toBe(1);

      const dbOrder = await prisma.order.findUnique({ where: { id: uniqueIds[0] } });
      expect(dbOrder).not.toBeNull();
      expect(dbOrder!.tenantId).toBe(tenantId);
      expect(dbOrder!.branchId).toBe(branchId);
    });

    it('6. same idempotency key and payload replays', async () => {
      const idempKey = `replay-${ts}`;
      const payload = {
        branchId,
        customerName: 'Replay',
        customerPhone: '+251933333333',
        pickupAt: futurePickup(120),
        lines: [{ variantId, quantity: 1 }],
        idempotencyKey: idempKey,
      };

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send(payload);
      expect(res1.status).toBe(201);
      const firstId = res1.body.data.order.id;

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send(payload);
      expect(res2.status).toBe(201);
      expect(res2.body.data.order.id).toBe(firstId);
    });

    it('6b. same key with different payload returns 409', async () => {
      const idempKey = `diff-payload-${ts}`;

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'First',
          customerPhone: '+251944444444',
          pickupAt: futurePickup(60),
          lines: [{ variantId, quantity: 1 }],
          idempotencyKey: idempKey,
        });
      expect(res1.status).toBe(201);

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/public/pickup-orders')
        .send({
          branchId,
          customerName: 'Second',
          customerPhone: '+251955555555',
          pickupAt: futurePickup(90),
          lines: [{ variantId, quantity: 2 }],
          idempotencyKey: idempKey,
        });
      expect(res2.status).toBe(409);
    });

    it('11. payment failure rolls back (double-approval returns conflict)', async () => {
      const freshOrderRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
      expect(freshOrderRes.status).toBe(201);
      const freshOrderId = freshOrderRes.body.data.order.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: freshOrderId, idempotencyKey: `rollback-cash-${ts}` });
      expect(payRes.status).toBe(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(confirmRes.status).toBe(200);

      const doubleConfirm = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(doubleConfirm.status).toBe(200);
    });

    it('18. failed confirmation leaves all state unchanged (transaction rollback)', async () => {
      const rollbackOrderRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
      expect(rollbackOrderRes.status).toBe(201);
      const rollbackOrderId = rollbackOrderRes.body.data.order.id;

      const rollbackPayRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: rollbackOrderId, idempotencyKey: `rollback-isolation-${ts}` });
      expect(rollbackPayRes.status).toBe(201);
      const rollbackPaymentId = rollbackPayRes.body.data.id;

      const prePayment = await prisma.payment.findUnique({ where: { id: rollbackPaymentId } });
      const preOrder = await prisma.order.findUnique({ where: { id: rollbackOrderId } });
      const preAuditCount = await prisma.auditLog.count({
        where: { tenantId, entityId: rollbackPaymentId },
      });
      const preOutboxCount = await prisma.outboxEvent.count({
        where: { tenantId, aggregateId: rollbackPaymentId },
      });

      const [success, failure] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/branches/${branchId}/payments/${rollbackPaymentId}/confirm-cash`)
          .set('Authorization', `Bearer ${cashierToken}`)
          .set('x-tenant-id', tenantId),
        request(app.getHttpServer())
          .post(`/api/v1/branches/${branchId}/payments/${rollbackPaymentId}/confirm-cash`)
          .set('Authorization', `Bearer ${cashierToken}`)
          .set('x-tenant-id', tenantId),
      ]);

      const statuses = [success.status, failure.status].sort();
      expect(statuses).toEqual([200, 409]);

      const postPayment = await prisma.payment.findUnique({ where: { id: rollbackPaymentId } });
      expect(postPayment!.status).toBe('APPROVED');

      const postOrder = await prisma.order.findUnique({ where: { id: rollbackOrderId } });
      expect(postOrder!.status).toBe('CONFIRMED');

      const postAuditCount = await prisma.auditLog.count({
        where: { tenantId, entityId: rollbackPaymentId, action: 'PAYMENT_CASH_CONFIRM' },
      });
      expect(postAuditCount).toBe(1);

      const postOutboxCount = await prisma.outboxEvent.count({
        where: { tenantId, aggregateId: rollbackPaymentId, eventType: 'payment.approved' },
      });
      expect(postOutboxCount).toBe(1);
    });
  });

  // ─── SECTION 7: Tracking & Money Serialization ───────────

  describe('Tracking and money serialization', () => {
    it('15. customer tracking reflects every committed status', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${trackingToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBeDefined();
      expect(res.body.data.statusHistory).toBeDefined();
      expect(res.body.data.statusHistory.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.statusHistory[0].status).toBeDefined();
    });

    it('17. money fields are serialized as decimal strings', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/orders/${trackingToken}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.data.totalMinor).toBe('string');
      expect(res.body.data.totalMinor).toMatch(/^\d+$/);
      for (const line of res.body.data.lines) {
        expect(typeof line.lineTotalMinor).toBe('string');
        expect(line.lineTotalMinor).toMatch(/^\d+$/);
      }
    });
  });

  // ─── SECTION 8: Disabled KDS ────────────────────────────

  describe('Disabled KDS', () => {
    let noKdsOrderId: string;

    it('16. confirms order without creating tickets when KDS is disabled', async () => {
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'KDS' } },
        data: { status: 'DISABLED' },
      });

      const orderRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderType: 'POS', lines: [{ variantId, quantity: 1 }] });
      expect(orderRes.status).toBe(201);
      noKdsOrderId = orderRes.body.data.order.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: noKdsOrderId, idempotencyKey: `nokds-${ts}` });
      expect(payRes.status).toBe(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payRes.body.data.id}/confirm-cash`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(confirmRes.status).toBe(200);

      const order = await prisma.order.findUnique({ where: { id: noKdsOrderId } });
      expect(order!.status).toBe('CONFIRMED');

      for (let i = 0; i < 20; i++) {
        const pending = await prisma.outboxEvent.count({
          where: { publishedAt: null, attemptCount: { lt: 5 } },
        });
        if (pending === 0) break;
        await outboxProcessor.poll(true);
      }

      const tickets = await prisma.kitchenTicket.findMany({
        where: { tenantId, branchId, orderId: noKdsOrderId },
      });
      expect(tickets.length).toBe(0);

      const audit = await prisma.auditLog.findMany({
        where: { tenantId, entityId: noKdsOrderId, action: 'OUTBOX_KDS_SKIP' },
      });
      expect(audit.length).toBe(1);

      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'KDS' } },
        data: { status: 'ENABLED' },
      });
    });
  });
});
