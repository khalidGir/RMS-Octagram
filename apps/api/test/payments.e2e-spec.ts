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
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test')) throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

describe('Phase 4A — Manual Transfer Payment Flow (e2e)', () => {
  let app: any;
  let outboxProcessor: OutboxProcessor;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let trackingToken: string;
  let paymentToken: string;
  let paymentId: string;
  let proofStorage: InMemoryProofStorage;

  const ts = Date.now();
  const ownerEmail = `p4a-owner-${ts}@test.com`;
  const managerEmail = `p4a-manager-${ts}@test.com`;
  const cashierEmail = `p4a-cashier-${ts}@test.com`;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: 'Test1234!' });
    if (!res.body?.data?.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.accessToken;
  };

  beforeAll(async () => {
    proofStorage = new InMemoryProofStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProofStorage)
      .useValue(proofStorage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Stop the outbox processor timer immediately; tests poll manually
    outboxProcessor = app.get(OutboxProcessor);
    outboxProcessor.stop();

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: 'PaymentTest', slug: `payment-test-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({ data: { tenantId, name: 'Main', slug: 'main', isActive: true } });
    branchId = branch.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });

    const manager = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });

    const cashier = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });

    ownerToken = await login(ownerEmail);
    managerToken = await login(managerEmail);
    cashierToken = await login(cashierEmail);

    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 0, isActive: true } });
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true } });
    await prisma.menuItemVariant.create({ data: { tenantId, name: 'Regular', sku: 'BURG-001', basePriceMinor: 25000n, isActive: true, menuItem: { connect: { id: item.id } } } });

    const table = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'T1', capacity: 4, isActive: true } });

    const crypto = await import('crypto');
    const trackingRaw = crypto.randomBytes(32).toString('base64url');
    const trackingHash = crypto.createHash('sha256').update(trackingRaw).digest('hex');

    await prisma.order.create({
      data: {
        tenantId, branchId, orderNumber: 1n, orderType: 'DINE_IN', status: 'PENDING_PAYMENT',
        tableId: table.id, currency: 'ETB', subtotalMinor: 25000n, totalMinor: 25000n,
        source: 'CUSTOMER_WEB', trackingTokenHash: trackingHash, version: 1,
      },
    });
    // Initialize branch order counter so subsequent orders get unique numbers
    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 1, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;
    trackingToken = trackingRaw;

    await prisma.paymentInstruction.create({
      data: { tenantId, branchId, method: 'CBE', label: 'CBE Birr', accountHolder: 'Test Restaurant', accountIdentifier: '1234567890', instructions: 'Transfer the exact amount' },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.paymentProof.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.paymentInstruction.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.idempotencyRecord.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, tenantId);
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.restaurantTable.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, managerEmail, cashierEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('Payment Instructions CRUD', () => {
    let instructionId: string;

    it('owner can create a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payment-instructions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ method: 'TELEBIRR', label: 'TeleBirr', accountHolder: 'Rest', accountIdentifier: '0911111111' });
      expect(res.status).toBe(201);
      expect(res.body.data.method).toBe('TELEBIRR');
      instructionId = res.body.data.id;
    });

    it('owner can list instructions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/payment-instructions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('owner can update a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/payment-instructions/${instructionId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ label: 'TeleBirr Updated' });
      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe('TeleBirr Updated');
    });

    it('manager can create a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payment-instructions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ method: 'CASH', label: 'Cash' });
      expect(res.status).toBe(201);
    });

    it('cashier cannot create a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payment-instructions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ method: 'TEST', label: 'Test' });
      expect(res.status).toBe(403);
    });

    it('cashier cannot update a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/payment-instructions/${instructionId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ label: 'Hacked' });
      expect(res.status).toBe(403);
    });

    it('cashier cannot delete a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branchId}/payment-instructions/${instructionId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('owner can delete a payment instruction', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branchId}/payment-instructions/${instructionId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });

    it('audit log was created for instruction CRUD', async () => {
      const logs = await prisma.auditLog.findMany({ where: { tenantId, entityType: 'PaymentInstruction' } });
      expect(logs.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Payment Creation - Idempotency', () => {
    const idempotencyKey = `test-key-${ts}`;

    it('creates payment and returns raw token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .set('Content-Type', 'application/json')
        .send({ trackingToken, idempotencyKey });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.paymentToken).toBeDefined();
      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.amountMinor).toBe('25000');
      paymentToken = res.body.data.paymentToken;
      paymentId = res.body.data.id;
    });

    it('replay with same key+payload returns same payment ID and token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .set('Content-Type', 'application/json')
        .send({ trackingToken, idempotencyKey });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(paymentId);
      expect(res.body.data.paymentToken).toBeDefined();
    });

    it('same key with different payload returns 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .set('Content-Type', 'application/json')
        .send({ trackingToken, idempotencyKey, customerReference: 'DIFFERENT' });
      expect(res.status).toBe(409);
    });

    it('rejects invalid tracking token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .set('Content-Type', 'application/json')
        .send({ trackingToken: 'invalid-token', idempotencyKey: `bad-${ts}` });
      expect(res.status).toBe(404);
    });

    it('rejects missing idempotency key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/manual-transfer')
        .set('Content-Type', 'application/json')
        .send({ trackingToken });
      expect(res.status).toBe(400);
    });
  });

  describe('Customer Payment Options', () => {
    it('returns branch payment instructions and order total', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payment-options')
        .set('Content-Type', 'application/json')
        .send({ trackingToken });
      expect(res.status).toBe(200);
      expect(res.body.data.instructions.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.totalMinor).toBe('25000');
      expect(res.body.data.currency).toBe('ETB');
    });
  });

  describe('Proof Upload Intent', () => {
    it('creates upload intent with presigned POST fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, contentType: 'image/jpeg', sizeBytes: 1048576, sha256: 'a'.repeat(64) });
      expect(res.status).toBe(200);
      expect(res.body.data.mediaObjectId).toBeDefined();
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.objectKey).toContain('/payments/');
      expect(res.body.data.fields).toBeDefined();
      expect(res.body.data.fields['x-amz-checksum-sha256']).toBeDefined();
      expect(res.body.data.expiresIn).toBe(300);
    });

    it('rejects invalid MIME type', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, contentType: 'application/pdf', sizeBytes: 1048576, sha256: 'a'.repeat(64) });
      expect(res.status).toBe(400);
    });

    it('rejects oversized file', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024, sha256: 'a'.repeat(64) });
      expect(res.status).toBe(400);
    });

    it('rejects invalid checksum format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, contentType: 'image/jpeg', sizeBytes: 1048576, sha256: 'not-a-valid-hex' });
      expect(res.status).toBe(400);
    });
  });

  describe('Successful Finalization', () => {
    let mediaObjectId: string;

    it('upload intent → simulate upload → finalize → PENDING_SCAN + proof + PENDING_VERIFICATION', async () => {
      const crypto = await import('crypto');

      // 1. Create upload intent
      const proofBytes = Buffer.from('test-proof-bytes');
      const sha256Hex = crypto.createHash('sha256').update(proofBytes).digest('hex');
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-upload')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, contentType: 'image/jpeg', sizeBytes: proofBytes.length, sha256: sha256Hex });
      expect(uploadRes.status).toBe(200);
      mediaObjectId = uploadRes.body.data.mediaObjectId;
      const objectKey = uploadRes.body.data.objectKey;

      // 2. Simulate the actual upload into the in-memory store
      proofStorage.simulateUpload(objectKey, proofBytes, 'image/jpeg', sha256Hex);

      // 3. Finalize
      const finalizeRes = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-finalize')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, mediaObjectId });
      expect(finalizeRes.status).toBe(200);

      // 4. Verify payment state
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment!.status).toBe('PENDING_VERIFICATION');
      expect(payment!.version).toBe(2);

      // 5. Verify media object scanStatus
      const media = await prisma.mediaObject.findUnique({ where: { id: mediaObjectId } });
      expect(media!.scanStatus).toBe('PENDING_SCAN');

      // 6. Verify exactly one current proof
      const proofs = await prisma.paymentProof.findMany({ where: { paymentId, isCurrent: true } });
      expect(proofs.length).toBe(1);
      expect(proofs[0].mediaObjectId).toBe(mediaObjectId);

      // 7. Verify audit log
      const audit = await prisma.auditLog.findMany({
        where: { tenantId, entityId: paymentId, action: 'PAYMENT_PROOF_SUBMITTED' },
      });
      expect(audit.length).toBeGreaterThanOrEqual(1);

      // 8. Verify outbox event
      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: paymentId, eventType: 'payment.submitted' },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(1);
    });

    it('non-empty review queue serializes BigInt to strings', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/payments?status=PENDING_VERIFICATION`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const p = res.body.data.find((x: any) => x.id === paymentId);
      expect(p).toBeDefined();
      expect(typeof p.amountMinor).toBe('string');
      expect(typeof p.order.totalMinor).toBe('string');
      expect(typeof p.order.orderNumber).toBe('string');
      expect(p.version).toBe(2);
    });
  });

  describe('Substituted Media Object', () => {
    it('finalize rejects a fabricated media object ID', async () => {
      const fakeMediaId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/payments/proof-finalize')
        .set('Content-Type', 'application/json')
        .send({ paymentToken, mediaObjectId: fakeMediaId });
      expect(res.status).toBe(404);
    });
  });

  describe('Expired Payment Token', () => {
    it('rejects upload intent with expired payment token', async () => {
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TEXP', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 99n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 10000n, totalMinor: 10000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `exp-${ts}` });
      const expToken = cr.body.data.paymentToken;
      const tokenHash = crypto.createHash('sha256').update(expToken).digest('hex');
      await prisma.payment.updateMany({ where: { paymentTokenHash: tokenHash }, data: { paymentTokenExpiresAt: new Date(Date.now() - 3600_000) } });
      const res = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken: expToken, contentType: 'image/jpeg', sizeBytes: 1000, sha256: 'c'.repeat(64) });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('expired');
      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Expired Upload Intent', () => {
    it('finalize rejects an expired upload intent', async () => {
      const upRes = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken, contentType: 'image/webp', sizeBytes: 200000, sha256: 'd'.repeat(64) });
      const mid = upRes.body.data.mediaObjectId;
      await prisma.mediaObject.update({ where: { id: mid }, data: { uploadExpiresAt: new Date(Date.now() - 60_000) } });
      const res = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken, mediaObjectId: mid });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('expired');
    });
  });

  describe('Payment Detail', () => {
    it('returns serialized payment details', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${branchId}/payments/${paymentId}`).set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(paymentId);
      expect(typeof res.body.data.amountMinor).toBe('string');
      expect(res.body.data.order).toBeDefined();
    });

    it('returns 404 for non-existent payment', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${branchId}/payments/00000000-0000-0000-0000-000000000000`).set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(404);
    });
  });

  describe('Proof URL', () => {
    it('denies proof URL for payment with no proofs', async () => {
      // Create a new payment with no proofs
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TNOPF', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 200n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `nopf-${ts}` });
      const nopfPaymentId = cr.body.data.id;

      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${branchId}/payments/${nopfPaymentId}/proof-url`).set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(404);

      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });

    it('denies proof URL for non-CLEAN proof', async () => {
      // Create a fresh payment for this test
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TNCLN', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 201n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `ncln-${ts}` });
      const testPaymentId = cr.body.data.id;

      const mediaObj = await prisma.mediaObject.create({
        data: {
          tenantId, branchId, paymentId: testPaymentId, purpose: 'PAYMENT_PROOF', bucket: 'test-bucket',
          objectKey: 'fake/key.jpg', contentType: 'image/jpeg', sizeBytes: 1000n,
          sha256: 'e'.repeat(64), scanStatus: 'PENDING_SCAN',
        },
      });
      const proof = await prisma.paymentProof.create({
        data: {
          tenantId, branchId, paymentId: testPaymentId, mediaObjectId: mediaObj.id,
          submittedByContext: 'CUSTOMER', isCurrent: true,
        },
      });

      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${branchId}/payments/${testPaymentId}/proof-url`).set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('not yet cleared');

      await prisma.paymentProof.delete({ where: { id: proof.id } });
      await prisma.mediaObject.delete({ where: { id: mediaObj.id } });
      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Concurrent Payment Creation', () => {
    it('two concurrent payment creations produce one active payment', async () => {
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TCONC', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 300n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });

      const key = `conc-${ts}`;
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: key }),
        request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: key }),
      ]);

      // Both requests use the same idempotency key. Depending on timing:
      // - Both 201 (second sees existing payment, throws ConflictException caught by handler → 409)
      // - One 201 + one 409 (idempotency blocks the second)
      // Either way, exactly one active payment for this order.
      const statuses = [r1.status, r2.status].sort();
      expect(statuses[0]).toBe(201);
      expect([201, 409]).toContain(statuses[1]);

      // Only one active payment for this order
      const activePayments = await prisma.payment.findMany({
        where: { tenantId, orderId: ord.id, status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED'] } },
      });
      expect(activePayments.length).toBe(1);

      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });

    it('two different idempotency keys for same order produce one 201 + one 409', async () => {
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TCON2', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 310n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });

      // Two requests with different idempotency keys for the same order
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `diff-a-${ts}` }),
        request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `diff-b-${ts}` }),
      ]);

      // One 201, one 409 (stable conflict, not 500/P2002)
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      // Only one active payment for this order
      const activePayments = await prisma.payment.findMany({
        where: { tenantId, orderId: ord.id, status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED'] } },
      });
      expect(activePayments.length).toBe(1);

      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Concurrent Finalization', () => {
    it('two concurrent finalizations produce one current proof', async () => {
      const crypto = await import('crypto');

      // Create a fresh payment
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TFINC', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 301n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `finc-${ts}` });
      const testPaymentToken = cr.body.data.paymentToken;
      const testPaymentId = cr.body.data.id;

      // Create upload intent
      const proofBytes = Buffer.from('conc-final-bytes');
      const sha = crypto.createHash('sha256').update(proofBytes).digest('hex');
      const upRes = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, contentType: 'image/jpeg', sizeBytes: proofBytes.length, sha256: sha });
      const mid = upRes.body.data.mediaObjectId;
      const ok = upRes.body.data.objectKey;

      // Simulate upload
      proofStorage.simulateUpload(ok, proofBytes, 'image/jpeg', sha);

      // Two concurrent finalizations with the same media intent
      const [f1, f2] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, mediaObjectId: mid }),
        request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, mediaObjectId: mid }),
      ]);

      // Both should succeed (idempotent) — one claims the upload, the other returns existing
      // OR one wins and one gets 409 (true race). Both are valid outcomes.
      const statuses = [f1.status, f2.status].sort();
      expect(statuses[0]).toBe(200);
      expect([200, 409]).toContain(statuses[1]);

      // Exactly one current proof
      const currentProofs = await prisma.paymentProof.findMany({ where: { paymentId: testPaymentId, isCurrent: true } });
      expect(currentProofs.length).toBe(1);

      // Exactly one proof total (no duplication)
      const allProofs = await prisma.paymentProof.findMany({ where: { paymentId: testPaymentId } });
      expect(allProofs.length).toBe(1);

      await prisma.paymentProof.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.mediaObject.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Idempotent Finalization', () => {
    it('repeated finalization of same media returns existing result without duplication', async () => {
      const crypto = await import('crypto');

      // Create a fresh payment
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TIDEM', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 302n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `idem-${ts}` });
      const testPaymentToken = cr.body.data.paymentToken;
      const testPaymentId = cr.body.data.id;

      // Create upload intent
      const proofBytes = Buffer.from('idem-proof');
      const sha = crypto.createHash('sha256').update(proofBytes).digest('hex');
      const upRes = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, contentType: 'image/png', sizeBytes: proofBytes.length, sha256: sha });
      const mid = upRes.body.data.mediaObjectId;
      const ok = upRes.body.data.objectKey;

      // Simulate upload
      proofStorage.simulateUpload(ok, proofBytes, 'image/png', sha);

      // Count before
      const proofsBefore = await prisma.paymentProof.count({ where: { paymentId: testPaymentId } });
      const auditBefore = await prisma.auditLog.count({ where: { tenantId, entityId: testPaymentId, action: 'PAYMENT_PROOF_SUBMITTED' } });
      const outboxBefore = await prisma.outboxEvent.count({ where: { tenantId, aggregateId: testPaymentId, eventType: 'payment.submitted' } });

      // First finalization succeeds
      const f1 = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, mediaObjectId: mid });
      expect(f1.status).toBe(200);

      // Second finalization of same media returns 200 (idempotent), not 409
      const f2 = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, mediaObjectId: mid });
      expect(f2.status).toBe(200);

      // Exactly one current proof — no duplication
      const currentProofs = await prisma.paymentProof.findMany({ where: { paymentId: testPaymentId, isCurrent: true } });
      expect(currentProofs.length).toBe(1);

      // No extra proofs, audit, or outbox beyond what the first finalization created
      const proofsAfter = await prisma.paymentProof.count({ where: { paymentId: testPaymentId } });
      const auditAfter = await prisma.auditLog.count({ where: { tenantId, entityId: testPaymentId, action: 'PAYMENT_PROOF_SUBMITTED' } });
      const outboxAfter = await prisma.outboxEvent.count({ where: { tenantId, aggregateId: testPaymentId, eventType: 'payment.submitted' } });
      expect(proofsAfter).toBe(proofsBefore + 1);
      expect(auditAfter).toBe(auditBefore + 1);
      expect(outboxAfter).toBe(outboxBefore + 1);

      await prisma.paymentProof.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.mediaObject.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Proof Attempt Limit (Per-Payment)', () => {
    it('counts consumed uploads per payment, not per branch', async () => {
      // Create two fresh payments for the same order
      const crypto = await import('crypto');
      const tr = crypto.randomBytes(32).toString('base64url');
      const th = crypto.createHash('sha256').update(tr).digest('hex');
      const tbl = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'TATMP', capacity: 2, isActive: true } });
      const ord = await prisma.order.create({
        data: { tenantId, branchId, orderNumber: 303n, orderType: 'TAKEAWAY', status: 'PENDING_PAYMENT', tableId: tbl.id, currency: 'ETB', subtotalMinor: 5000n, totalMinor: 5000n, source: 'CUSTOMER_WEB', trackingTokenHash: th, version: 1 },
      });
      const cr = await request(app.getHttpServer()).post('/api/v1/public/payments/manual-transfer').set('Content-Type', 'application/json').send({ trackingToken: tr, idempotencyKey: `atmp-${ts}` });
      const testPaymentToken = cr.body.data.paymentToken;
      const testPaymentId = cr.body.data.id;

      // Create 3 consumed uploads for this payment (all finalized)
      for (let i = 0; i < 3; i++) {
        const data = `proof-attempt-${i}`;
        const sha = crypto.createHash('sha256').update(data).digest('hex');
        const upRes = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, contentType: 'image/jpeg', sizeBytes: data.length, sha256: sha });
        const mid = upRes.body.data.mediaObjectId;
        const ok = upRes.body.data.objectKey;
        proofStorage.simulateUpload(ok, Buffer.from(data), 'image/jpeg', sha);
        await request(app.getHttpServer()).post('/api/v1/public/payments/proof-finalize').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, mediaObjectId: mid });
      }

      // 4th upload intent for SAME payment should be rejected
      const res = await request(app.getHttpServer()).post('/api/v1/public/payments/proof-upload').set('Content-Type', 'application/json').send({ paymentToken: testPaymentToken, contentType: 'image/jpeg', sizeBytes: 500, sha256: '3'.repeat(64) });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Maximum proof upload attempts');

      await prisma.paymentProof.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.mediaObject.deleteMany({ where: { tenantId, paymentId: testPaymentId } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { tenantId, orderId: ord.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: ord.id } }).catch(() => {});
      await prisma.restaurantTable.delete({ where: { id: tbl.id } }).catch(() => {});
    });
  });

  describe('Cross-Branch Denial', () => {
    it('staff cannot list payments for unassigned branch', async () => {
      const otherBranch = await prisma.branch.create({ data: { tenantId, name: 'Other', slug: `other-${ts}`, isActive: true } });
      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${otherBranch.id}/payments`).set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
      await prisma.branch.delete({ where: { id: otherBranch.id } });
    });

    it('staff cannot create instruction on unassigned branch', async () => {
      const otherBranch = await prisma.branch.create({ data: { tenantId, name: 'Other2', slug: `other2-${ts}`, isActive: true } });
      const res = await request(app.getHttpServer()).post(`/api/v1/branches/${otherBranch.id}/payment-instructions`).set('Authorization', `Bearer ${managerToken}`).set('x-tenant-id', tenantId).send({ method: 'X', label: 'X' });
      expect(res.status).toBe(403);
      await prisma.branch.delete({ where: { id: otherBranch.id } });
    });
  });

  describe('Cross-Tenant Denial', () => {
    let otherTenantId: string;
    let otherBranchId: string;
    let otherToken: string;

    beforeAll(async () => {
      const ts2 = Date.now();
      const t2 = await prisma.tenant.create({ data: { name: 'OtherTenant', slug: `other-tenant-${ts2}`, status: 'ACTIVE' } });
      otherTenantId = t2.id;
      await seedEntitlements(prisma, otherTenantId);
      const b2 = await prisma.branch.create({ data: { tenantId: otherTenantId, name: 'B1', slug: 'b1', isActive: true } });
      otherBranchId = b2.id;
      const u2 = await prisma.user.create({ data: { email: `other-owner-${ts2}@test.com`, passwordHash: await argon2.hash('Test1234!', { type: argon2.argon2id }), displayName: 'O2', status: 'ACTIVE' } });
      const m2 = await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: u2.id, role: 'OWNER', status: 'ACTIVE' } });
      await prisma.branchAssignment.create({ data: { tenantId: otherTenantId, branchId: otherBranchId, membershipId: m2.id } });
      otherToken = await login(`other-owner-${ts2}@test.com`);
    });

    afterAll(async () => {
      await prisma.branchAssignment.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
      await cleanupEntitlements(prisma, otherTenantId);
      await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
    });

    it('staff cannot list payments for another tenant branch', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${otherBranchId}/payments`).set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', otherTenantId);
      expect(res.status).toBe(403);
    });

    it('staff cannot access payment detail from another tenant', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/branches/${branchId}/payments/${paymentId}`).set('Authorization', `Bearer ${otherToken}`).set('x-tenant-id', otherTenantId);
      expect(res.status).toBe(404);
    });
  });

  // ─── Phase 4B: Payment Approval + KDS ─────────────

  describe('Phase 4B — Payment Approval & KDS (e2e)', () => {
    let orderId: string;
    let paymentId2: string;
    let stationId: string;
    let variantId: string;
    let orderVersion = 1;

    beforeAll(async () => {
      // Create a menu item, variant, and assign to station
      const cat = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 1 } });
      const item = await prisma.menuItem.create({ data: { tenantId, categoryId: cat.id, name: 'Burger', isActive: true } });
      const variant = await prisma.menuItemVariant.create({ data: { tenantId, menuItemId: item.id, name: 'Regular', basePriceMinor: 2500n, currency: 'ETB', isDefault: true } });
      variantId = variant.id;
      await prisma.branchMenuItem.create({ data: { branchId, menuItemId: item.id, tenantId, isAvailable: true } });

      // Create kitchen station
      const stationRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-stations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Grill', displayOrder: 0 });
      expect(stationRes.status).toBe(201);
      stationId = stationRes.body.data.id;

      // Assign menu item to station
      const assignRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-stations/${stationId}/menu-items`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ menuItemId: item.id });
      expect(assignRes.status).toBe(201);

      // Create POS order directly in DB to avoid counter conflicts
      const nextNumber = await prisma.$queryRaw<{ lastNumber: bigint }[]>`
        INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
        VALUES (${branchId}, 1, now(), now())
        ON CONFLICT ("branchId") DO UPDATE
        SET "lastNumber" = "BranchOrderCounter"."lastNumber" + 1, "updatedAt" = now()
        RETURNING "lastNumber"
      `;
      const orderNumber = nextNumber[0].lastNumber;

      const order = await prisma.order.create({
        data: {
          tenantId,
          branchId,
          orderNumber,
          orderType: 'POS',
          status: 'PENDING_CONFIRMATION',
          currency: 'ETB',
          subtotalMinor: 2500n,
          discountMinor: 0n,
          taxMinor: 0n,
          serviceChargeMinor: 0n,
          totalMinor: 2500n,
          source: 'CASHIER_POS',
          version: 1,
        },
      });
      orderId = order.id;
      orderVersion = 1;

      await prisma.orderLine.create({
        data: {
          tenantId,
          branchId,
          orderId: order.id,
          menuItemId: item.id,
          variantId: variant.id,
          itemNameSnapshot: 'Burger',
          variantNameSnapshot: 'Regular',
          unitPriceMinor: 2500n,
          quantity: 1,
          lineTotalMinor: 2500n,
        },
      });

      await prisma.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PENDING_CONFIRMATION',
          actorUserId: null,
        },
      });
    });

    it('staff can create a manual transfer for a POS order', async () => {
      const crypto = await import('crypto');
      const proofBytes = Buffer.alloc(1024);
      const sha256 = crypto.createHash('sha256').update(proofBytes).digest('hex');

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/manual-transfer`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          orderId,
          idempotencyKey: `e2e-pay-${Date.now()}`,
        });
      expect(payRes.status).toBe(201);
      paymentId2 = payRes.body.data.id;

      const intentRes = await request(app.getHttpServer())
        .post(`/api/v1/public/payments/proof-upload`)
        .set('Content-Type', 'application/json')
        .send({
          paymentToken: payRes.body.data.paymentToken,
          contentType: 'image/jpeg',
          sizeBytes: proofBytes.length,
          sha256,
        });
      expect(intentRes.status).toBe(200);

      proofStorage.simulateUpload(intentRes.body.data.objectKey, proofBytes, 'image/jpeg', sha256);

      const finalizeRes = await request(app.getHttpServer())
        .post(`/api/v1/public/payments/proof-finalize`)
        .set('x-tenant-id', tenantId)
        .send({
          paymentToken: payRes.body.data.paymentToken,
          mediaObjectId: intentRes.body.data.mediaObjectId,
        });
      expect(finalizeRes.status).toBe(200);
    });

    it('cashier can approve a PENDING_VERIFICATION payment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${paymentId2}/approve`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reviewNote: 'Looks good' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
    });

    it('order is CONFIRMED after payment approval', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CONFIRMED');
    });

    it('kitchen tickets were created for the confirmed order', async () => {
      await outboxProcessor.poll(true);

      const publishedEvent = await prisma.outboxEvent.findFirst({
        where: { tenantId, aggregateId: orderId, eventType: 'order.confirmed' },
      });
      expect(publishedEvent).not.toBeNull();
      expect(publishedEvent!.publishedAt).not.toBeNull();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      const tickets = res.body.data;
      expect(tickets.length).toBeGreaterThanOrEqual(1);
      expect(tickets[0].orderId).toBe(orderId);
      expect(tickets[0].status).toBe('QUEUED');

      await outboxProcessor.poll(true);
      const res2 = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res2.body.data.length).toBe(tickets.length);
    });

    it('kitchen staff can bump a QUEUED ticket to IN_PROGRESS', async () => {
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets?status=QUEUED`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      const ticket = listRes.body.data[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticket.id}/bump`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticket.version });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
    });

    it('bump again moves to READY', async () => {
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets?status=IN_PROGRESS`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      const ticket = listRes.body.data[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticket.id}/bump`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticket.version });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
    });

    it('complete moves READY to COMPLETED', async () => {
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets?status=READY`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      const ticket = listRes.body.data[0];

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/kitchen-tickets/${ticket.id}/complete`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: ticket.version });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('order becomes READY when all tickets completed', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('READY');
    });

    it('reject payment with reason', async () => {
      const crypto = await import('crypto');
      // Create another order directly in DB
      const nextNum2 = await prisma.$queryRaw<{ lastNumber: bigint }[]>`
        INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
        VALUES (${branchId}, 1, now(), now())
        ON CONFLICT ("branchId") DO UPDATE
        SET "lastNumber" = "BranchOrderCounter"."lastNumber" + 1, "updatedAt" = now()
        RETURNING "lastNumber"
      `;
      const order2 = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber: nextNum2[0].lastNumber,
          orderType: 'POS', status: 'PENDING_CONFIRMATION', currency: 'ETB',
          subtotalMinor: 2500n, discountMinor: 0n, taxMinor: 0n,
          serviceChargeMinor: 0n, totalMinor: 2500n, source: 'CASHIER_POS', version: 1,
        },
      });
      const firstItem = await prisma.menuItem.findFirst({ where: { tenantId } });
      await prisma.orderLine.create({
        data: {
          tenantId, branchId, orderId: order2.id, menuItemId: firstItem!.id,
          variantId, itemNameSnapshot: 'Burger', variantNameSnapshot: 'Regular',
          unitPriceMinor: 2500n, quantity: 1, lineTotalMinor: 2500n,
        },
      });
      await prisma.orderStatusHistory.create({
        data: { tenantId, branchId, orderId: order2.id, fromStatus: null, toStatus: 'PENDING_CONFIRMATION', actorUserId: null },
      });

      const proofBytes2 = Buffer.alloc(512);
      const sha256_2 = crypto.createHash('sha256').update(proofBytes2).digest('hex');

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/manual-transfer`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          orderId: order2.id,
          idempotencyKey: `e2e-reject-pay-${Date.now()}`,
        });
      const payId2 = payRes.body.data.id;

      const intentRes = await request(app.getHttpServer())
        .post(`/api/v1/public/payments/proof-upload`)
        .set('x-tenant-id', tenantId)
        .send({
          paymentToken: payRes.body.data.paymentToken,
          contentType: 'image/jpeg',
          sizeBytes: proofBytes2.length,
          sha256: sha256_2,
        });
      proofStorage.simulateUpload(intentRes.body.data.objectKey, proofBytes2, 'image/jpeg', sha256_2);

      await request(app.getHttpServer())
        .post(`/api/v1/public/payments/proof-finalize`)
        .set('x-tenant-id', tenantId)
        .send({
          paymentToken: payRes.body.data.paymentToken,
          mediaObjectId: intentRes.body.data.mediaObjectId,
        });

      // Reject
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/${payId2}/reject`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ reason: 'Suspicious transfer reference' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('REJECTED');

      // Cleanup
      await prisma.orderLine.deleteMany({ where: { orderId: order2.id } }).catch(() => {});
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: order2.id } }).catch(() => {});
      await prisma.order.delete({ where: { id: order2.id } }).catch(() => {});
    });
  });
});
