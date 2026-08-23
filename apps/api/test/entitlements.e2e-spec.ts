import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test')) throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const ts = Date.now();

describe('Platform Feature Entitlements (e2e)', () => {
  let app: INestApplication;
  let superAdminToken: string;
  const superAdminEmail = `sa-ent-${ts}@test.com`;

  let ownerToken: string;
  const ownerEmail = `owner-ent-${ts}@test.com`;
  let tenantId: string;
  let branchId: string;

  let managerToken: string;
  const managerEmail = `mgr-ent-${ts}@test.com`;

  let cashierToken: string;
  const cashierEmail = `cash-ent-${ts}@test.com`;

  let tenant2Id: string;
  let owner2Token: string;
  const owner2Email = `owner2-ent-${ts}@test.com`;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Test1234!' });
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    app.get(OutboxProcessor).stop();

    // Super admin
    await prisma.user.create({
      data: { email: superAdminEmail, passwordHash, displayName: 'SA', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    superAdminToken = await login(superAdminEmail);

    // Tenant 1
    const t = await prisma.tenant.create({ data: { name: 'Ent T1', slug: `ent-t1-${ts}`, status: 'ACTIVE' } });
    tenantId = t.id;
    await seedEntitlements(prisma, tenantId);
    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    const branch = await prisma.branch.create({ data: { tenantId, name: 'Main', slug: `ent-main-${ts}`, isActive: true } });
    branchId = branch.id;
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(ownerEmail);

    const mgr = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Mgr', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: mgr.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });
    managerToken = await login(managerEmail);

    const cash = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cash', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cash.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });
    cashierToken = await login(cashierEmail);

    // Tenant 2
    const t2 = await prisma.tenant.create({ data: { name: 'Ent T2', slug: `ent-t2-${ts}`, status: 'ACTIVE' } });
    tenant2Id = t2.id;
    await seedEntitlements(prisma, tenant2Id);
    const owner2 = await prisma.user.create({ data: { email: owner2Email, passwordHash, displayName: 'Owner2', status: 'ACTIVE' } });
    await prisma.tenantMembership.create({ data: { tenantId: tenant2Id, userId: owner2.id, role: 'OWNER', status: 'ACTIVE' } });
    owner2Token = await login(owner2Email);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    const tenantIds = [tenantId, tenant2Id].filter(Boolean);
    for (const tid of tenantIds) {
      await prisma.branchAssignment.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.featureSetting.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await cleanupEntitlements(prisma, tid);
      await prisma.tenant.deleteMany({ where: { id: tid } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { contains: '-ent-' } } }).catch(() => {});
    await prisma.$disconnect();
  });

  const hdr = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'x-tenant-id': tenantId,
  });
  const hdr2 = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'x-tenant-id': tenant2Id,
  });

  // ═══════════════════════════════════════════════
  // 1. PLATFORM ADMIN — ENTITLEMENT CRUD
  // ═══════════════════════════════════════════════
  describe('Platform Admin — Entitlement CRUD', () => {
    it('lists entitlements for a tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(9);
      expect(res.body.data.find((e: any) => e.featureKey === 'TABLE_QR_ORDERING').status).toBe('ENABLED');
    });

    it('sets a single entitlement to DISABLED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED', reason: 'Testing disable' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DISABLED');
    });

    it('sets a single entitlement to ENABLED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ENABLED');
    });

    it('sets entitlement to SUSPENDED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PICKUP_ORDERING`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'SUSPENDED', reason: 'Testing suspend' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');
      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PICKUP_ORDERING`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });

    it('sets entitlement to TRIAL with future trialEndsAt', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PAYMENT_GATEWAY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'TRIAL', trialEndsAt: futureDate, reason: 'Trial' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('TRIAL');
      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PAYMENT_GATEWAY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });

    it('rejects TRIAL without trialEndsAt', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PAYMENT_GATEWAY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'TRIAL' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid status', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/PAYMENT_GATEWAY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'INVALID_STATUS' });
      expect(res.status).toBe(400);
    });

    it('denies non-super-admin', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);
    });

    it('computes effective feature map', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features/effective`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('TABLE_QR_ORDERING');
      expect(res.body.data.TABLE_QR_ORDERING.effective).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 2. DISABLED ENTITLEMENT → FEATURE GATED
  // ═══════════════════════════════════════════════
  describe('Disabled Entitlement → Feature Gated', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/KDS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED', reason: 'Feature gate test' });
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/KDS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });

    it('tenant features show KDS as not effective', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      const kds = res.body.data.find((f: any) => f.featureKey === 'KDS');
      expect(kds.effective).toBe(false);
      expect(kds.entitlementStatus).toBe('DISABLED');
    });

    it('setTenantFeature fails when entitlement is DISABLED', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/tenants/features/KDS')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // 3. TENANT-LEVEL TOGGLE
  // ═══════════════════════════════════════════════
  describe('Tenant-Level Toggle', () => {
    it('owner can disable TABLE_QR_ORDERING at tenant level', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/tenants/features/TABLE_QR_ORDERING')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });
      expect(res.status).toBe(200);

      const eff = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      const qr = eff.body.data.find((f: any) => f.featureKey === 'TABLE_QR_ORDERING');
      expect(qr.tenantEnabled).toBe(false);
      expect(qr.effective).toBe(false);
    });

    it('owner can re-enable TABLE_QR_ORDERING', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/tenants/features/TABLE_QR_ORDERING')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
      expect(res.status).toBe(200);
    });

    it('manager cannot toggle tenant-level features', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/tenants/features/TABLE_QR_ORDERING')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // 4. BRANCH OVERRIDE — INHERIT / ENABLED / DISABLED
  // ═══════════════════════════════════════════════
  describe('Branch Override', () => {
    it('no branch row → INHERIT', async () => {
      await prisma.featureSetting.deleteMany({ where: { tenantId, branchId, featureKey: 'INVENTORY' } });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features/effective?branchId=${branchId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.INVENTORY.effective).toBe(true);
    });

    it('owner can set branch override DISABLED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/branches/${branchId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });
      expect(res.status).toBe(200);

      const eff = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features/effective?branchId=${branchId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(eff.body.data.INVENTORY.effective).toBe(false);
    });

    it('owner can set branch override ENABLED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/branches/${branchId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
      expect(res.status).toBe(200);

      const eff = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features/effective?branchId=${branchId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(eff.body.data.INVENTORY.effective).toBe(true);
    });

    it('manager can set branch override', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/branches/${branchId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/branches/${branchId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
    });

    it('cashier cannot set branch override', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/branches/${branchId}/features/TABLE_QR_ORDERING`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // 5. EXPIRED TRIAL → FAIL CLOSED
  // ═══════════════════════════════════════════════
  describe('Expired Trial', () => {
    it('expired trial disables the feature', async () => {
      // Use Prisma directly to set an expired trial (API rejects past trialEndsAt via validation)
      const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'PICKUP_ORDERING' } },
        data: { status: 'TRIAL', trialEndsAt: pastDate },
      });

      const eff = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      const pickup = eff.body.data.find((f: any) => f.featureKey === 'PICKUP_ORDERING');
      expect(pickup.effective).toBe(false);
      expect(pickup.entitlementStatus).toBe('TRIAL');

      // Restore
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'PICKUP_ORDERING' } },
        data: { status: 'ENABLED', trialEndsAt: null },
      });
    });
  });

  // ═══════════════════════════════════════════════
  // 6. DEPENDENCY DISABLED — BATCH_INVENTORY needs INVENTORY
  // ═══════════════════════════════════════════════
  describe('Dependency Disabled', () => {
    it('disabling INVENTORY at platform level disables BATCH_INVENTORY', async () => {
      // Ensure BATCH_INVENTORY is ENABLED at platform level first
      // (it's seeded as DISABLED since it's not in DEFAULT_ENABLED_FEATURES)
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/BATCH_INVENTORY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });

      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED' });

      const eff = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features/effective`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(eff.status).toBe(200);
      expect(eff.body.data.BATCH_INVENTORY.effective).toBe(false);
      expect(eff.body.data.BATCH_INVENTORY.disabledReason).toBe('DEPENDENCY_DISABLED');

      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/INVENTORY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/BATCH_INVENTORY`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED' });
    });

    it('disabling INVENTORY at tenant level also disables BATCH_INVENTORY', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/tenants/features/INVENTORY')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });

      const eff = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      const batchInv = eff.body.data.find((f: any) => f.featureKey === 'BATCH_INVENTORY');
      expect(batchInv.effective).toBe(false);

      // Restore
      await request(app.getHttpServer())
        .put('/api/v1/tenants/features/INVENTORY')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
    });
  });

  // ═══════════════════════════════════════════════
  // 7. CROSS-TENANT MUTATION DENIED
  // ═══════════════════════════════════════════════
  describe('Cross-Tenant Mutation Denied', () => {
    it('owner of tenant1 cannot toggle features for tenant2', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/tenants/features/KDS')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenant2Id)
        .send({ enabled: false });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // 8. UNAUTHORIZED ROLES
  // ═══════════════════════════════════════════════
  describe('Unauthorized Roles', () => {
    it('cashier cannot list tenant features', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('unauthenticated cannot list tenant features', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════
  // 9. OUTBOX — KDS SKIP WHEN DISABLED
  // ═══════════════════════════════════════════════
  describe('Outbox KDS Skip', () => {
    it('outbox processor marks event published when KDS is disabled', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/KDS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED' });

      const event = await prisma.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: 'test-order-kds',
          eventType: 'order.confirmed',
          payload: { orderId: 'test-order-kds', paymentId: 'pay-kds', totalMinor: '5000' },
          attemptCount: 0,
        },
      });

      const processor = app.get(OutboxProcessor);
      processor.start();

      // Poll for result with retries instead of fixed timeout
      let updated = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
      for (let i = 0; i < 10 && updated?.publishedAt === null; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        updated = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
      }
      processor.stop();

      expect(updated).not.toBeNull();
      expect(updated!.publishedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { tenantId, action: 'OUTBOX_KDS_SKIP' },
      });
      expect(audit).not.toBeNull();

      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/KDS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });
  });

  // ═══════════════════════════════════════════════
  // 10. MISSING ENTITLEMENT → FAIL CLOSED
  // ═══════════════════════════════════════════════
  describe('Missing Entitlement → Fail Closed', () => {
    it('tenant without entitlements has all features disabled', async () => {
      const t = await prisma.tenant.create({
        data: { name: 'NoEnt', slug: `noent-${ts}`, status: 'ACTIVE' },
      });

      const eff = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${t.id}/features/effective`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(eff.status).toBe(200);
      expect(eff.body.data.TABLE_QR_ORDERING.effective).toBe(false);

      await prisma.tenantEntitlement.deleteMany({ where: { tenantId: t.id } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: t.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // 11. SUSPENDED ENTITLEMENT → 403
  // ═══════════════════════════════════════════════
  describe('Suspended Entitlement', () => {
    it('suspended entitlement disables the feature', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'SUSPENDED' });

      const eff = await request(app.getHttpServer())
        .get('/api/v1/tenants/features')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);
      const analytics = eff.body.data.find((f: any) => f.featureKey === 'ANALYTICS');
      expect(analytics.effective).toBe(false);
      expect(analytics.entitlementStatus).toBe('SUSPENDED');

      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });
  });

  // ═══════════════════════════════════════════════
  // 12. CONCURRENT UPDATES
  // ═══════════════════════════════════════════════
  describe('Concurrent Updates', () => {
    it('concurrent entitlement updates are idempotent', async () => {
      const p1 = request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED', reason: 'Concurrent 1' });
      const p2 = request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED', reason: 'Concurrent 2' });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect([r1.status, r2.status]).toEqual([200, 200]);

      // Final state should be one of the two
      const final = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      const analytics = final.body.data.find((e: any) => e.featureKey === 'ANALYTICS');
      expect(['ENABLED', 'DISABLED']).toContain(analytics.status);
    });
  });

  // ═══════════════════════════════════════════════
  // 13. AUDIT TRAIL
  // ═══════════════════════════════════════════════
  describe('Audit Trail', () => {
    it('entitlement update creates audit log', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { tenantId, action: 'ENTITLEMENT_UPDATE' },
      });

      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'DISABLED', reason: 'Audit test' });

      const afterCount = await prisma.auditLog.count({
        where: { tenantId, action: 'ENTITLEMENT_UPDATE' },
      });
      expect(afterCount).toBeGreaterThan(beforeCount);

      // Restore
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: 'ENABLED' });
    });

    it('feature setting update creates audit log', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { tenantId, action: 'FEATURE_SETTING_UPDATE' },
      });

      await request(app.getHttpServer())
        .put('/api/v1/tenants/features/TABLE_QR_ORDERING')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: false });

      const afterCount = await prisma.auditLog.count({
        where: { tenantId, action: 'FEATURE_SETTING_UPDATE' },
      });
      expect(afterCount).toBeGreaterThan(beforeCount);

      // Restore
      await request(app.getHttpServer())
        .put('/api/v1/tenants/features/TABLE_QR_ORDERING')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ enabled: true });
    });
  });
});
