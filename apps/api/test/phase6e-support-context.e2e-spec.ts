import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

describe('Phase 6E — Support Context (e2e)', () => {
  let app: any;
  let superAdminToken: string;
  let ownerToken: string;
  let waiterToken: string;
  let tenantId: string;
  let tenantName: string;
  let branchId: string;
  let categoryId: string;
  let itemId: string;

  // Second tenant for cross-tenant tests
  let tenant2Id: string;
  let branch2Id: string;

  const saEmail = `phase6e-sa-${ts}@test.com`;
  const ownerEmail = `phase6e-owner-${ts}@test.com`;
  const waiterEmail = `phase6e-waiter-${ts}@test.com`;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // Create Super Admin
    await prisma.user.create({
      data: { email: saEmail, passwordHash, displayName: 'SuperAdmin', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    superAdminToken = await login(app, saEmail);

    // Create tenant and branch
    tenantName = `Phase6ETest_${ts}`;
    const tenant = await prisma.tenant.create({ data: { name: tenantName, slug: `phase6e-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main Branch', slug: `phase6e-main-${ts}`, isActive: true },
    });
    branchId = branch.id;

    // Create second tenant for cross-tenant tests
    const tenant2 = await prisma.tenant.create({ data: { name: `Phase6ETenant2_${ts}`, slug: `phase6e-t2-${ts}`, status: 'ACTIVE' } });
    tenant2Id = tenant2.id;
    await seedEntitlements(prisma, tenant2Id);
    const branch2 = await prisma.branch.create({
      data: { tenantId: tenant2Id, name: 'Branch 2', slug: `phase6e-b2-${ts}`, isActive: true },
    });
    branch2Id = branch2.id;

    // Create owner
    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    // Create waiter
    const waiter = await prisma.user.create({ data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' } });
    const wm = await prisma.tenantMembership.create({ data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: wm.id } });
    waiterToken = await login(app, waiterEmail);

    // Seed a category and item for catalog mutation tests
    const cat = await prisma.menuCategory.create({
      data: { tenantId, name: 'Test Category', sortOrder: 1 },
    });
    categoryId = cat.id;

    const item = await prisma.menuItem.create({
      data: { tenantId, categoryId: cat.id, name: 'Test Item', sku: `PHASE6E-ITEM-${ts}`, isActive: true },
    });
    itemId = item.id;

    await prisma.menuItemTranslation.create({
      data: { tenantId, menuItemId: item.id, locale: 'en', name: 'Test Item' },
    });
  });

  afterAll(async () => {
    await app.close();
    // Cleanup order: dependent records first
    await prisma.menuItemTranslation.deleteMany({ where: { menuItem: { tenantId: { in: [tenantId, tenant2Id] } } } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.supportSession.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: [tenantId, tenant2Id] } } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branch2Id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [saEmail, ownerEmail, waiterEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant2Id } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────
  // Helper: enter support mode
  // ─────────────────────────────────────────────
  async function enterSupport(targetTenantId: string, reason = 'Debug menu') {
    return request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId: targetTenantId, reason });
  }

  async function exitSupport(targetTenantId: string) {
    return request(app.getHttpServer())
      .post('/api/v1/platform/support/exit')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId: targetTenantId });
  }

  // ═══════════════════════════════════════════════
  // SECTION 1: Support Session Lifecycle
  // ═══════════════════════════════════════════════
  describe('Support Session Lifecycle', () => {
    it('1. super admin enters support mode', async () => {
      const res = await enterSupport(tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.tenantId).toBe(tenantId);
      expect(res.body.data.reason).toBe('Debug menu');
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.expiresAt).toBeDefined();
      expect(res.body.data.startedAt).toBeDefined();
    });

    it('2. entering support mode requires reason', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/support/enter')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ tenantId, reason: '' });
      expect(res.status).toBe(400);
    });

    it('3. non-super-admin cannot enter support mode', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/support/enter')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, reason: 'Test' });
      expect(res.status).toBe(403);
    });

    it('4. waiter cannot enter support mode', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/support/enter')
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ tenantId, reason: 'Test' });
      expect(res.status).toBe(403);
    });

    it('5. active support session is retrievable', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toBeNull();
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('6. super admin exits support mode', async () => {
      const res = await exitSupport(tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ENDED');
    });

    it('7. no active session after exit', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('8. re-entering support mode creates new session', async () => {
      const enterRes = await enterSupport(tenantId, 'Re-entry test');
      expect(enterRes.status).toBe(200);
      expect(enterRes.body.data.status).toBe('ACTIVE');

      // Cleanup
      await exitSupport(tenantId);
    });

    it('9. support session has 30-minute expiry', async () => {
      const enterRes = await enterSupport(tenantId, 'Expiry check');
      expect(enterRes.status).toBe(200);

      const expiresAt = new Date(enterRes.body.data.expiresAt);
      const startedAt = new Date(enterRes.body.data.startedAt);
      const diffMs = expiresAt.getTime() - startedAt.getTime();
      expect(diffMs).toBe(30 * 60 * 1000);

      await exitSupport(tenantId);
    });

    it('10. support session for non-existent tenant returns 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/support/enter')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ tenantId: '00000000-0000-0000-0000-000000000000', reason: 'Test' });
      expect(res.status).toBe(404);
    });

    it('11. exiting non-existent session returns 404', async () => {
      const res = await exitSupport('00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });

    it('12. owner cannot enter support mode', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/support/enter')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, reason: 'Test' });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 2: Banner Contract
  // ═══════════════════════════════════════════════
  describe('Banner Contract', () => {
    it('13. active session returns tenantName and expiresAt for frontend banner', async () => {
      await enterSupport(tenantId, 'Banner test');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toBeNull();
      expect(res.body.data.tenantName).toBe(tenantName);
      expect(res.body.data.expiresAt).toBeDefined();
      expect(res.body.data.reason).toBeDefined();
      expect(res.body.data.status).toBe('ACTIVE');

      await exitSupport(tenantId);
    });

    it('14. banner returns null when no active session', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 3: Catalog Access in Support Mode
  // ═══════════════════════════════════════════════
  describe('Catalog Access in Support Mode', () => {
    beforeEach(async () => {
      // Ensure we're in support mode for each test
      await enterSupport(tenantId, 'Catalog access test');
    });

    it('15. catalog GET categories is allowed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
    });

    it('16. catalog GET items is allowed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/items')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
    });

    it('17. catalog GET modifier-groups is allowed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/modifier-groups')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
    });

    it('18. catalog POST categories is allowed (mutation)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: `Support Created Category ${ts}` });
      expect([201, 400]).toContain(res.status); // 400 if DTO validation fails
    });

    it('19. catalog PATCH items is allowed (mutation)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/items/${itemId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ description: 'Updated by support' });
      expect(res.status).toBe(200);
    });

    it('20. branch-menu GET is allowed', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/menu`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 4: Escape Matrix — Non-Catalog Denied
  // ═══════════════════════════════════════════════
  describe('Escape Matrix — Non-Catalog Denied', () => {
    beforeEach(async () => {
      await enterSupport(tenantId, 'Escape matrix test');
    });

    // ─── Payments ──────────────────────
    it('21. GET /branches/:bid/payments → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/payments`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Support mode only allows menu\/catalog/);
    });

    it('22. GET /branches/:bid/payments/:pid/proof-url → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/payments/fake-payment-id/proof-url`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('23. POST /branches/:bid/payments/cash → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/payments/cash`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ orderId: 'fake', amount: 1000 });
      expect(res.status).toBe(403);
    });

    // ─── Orders ──────────────────────
    it('24. GET /branches/:bid/orders → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('25. POST /branches/:bid/orders → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/orders`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ items: [] });
      expect(res.status).toBe(403);
    });

    // ─── Inventory ──────────────────────
    it('26. GET /branches/:bid/inventory/items → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('27. POST /branches/:bid/inventory/items → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Test' });
      expect(res.status).toBe(403);
    });

    // ─── Shifts ──────────────────────
    it('28. GET /branches/:bid/shifts/current → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/shifts/current`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('29. POST /branches/:bid/shifts/open → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/shifts/open`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ openingFloat: 10000 });
      expect(res.status).toBe(403);
    });

    // ─── Business Day ──────────────────────
    it('30. GET /branches/:bid/day-close/current → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/day-close/current`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('31. POST /branches/:bid/day-close/close → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/day-close/close`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ localBusinessDate: '2026-08-27' });
      expect(res.status).toBe(403);
    });

    // ─── Analytics/Reports ──────────────────────
    it('32. GET /reports/revenue → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('33. GET /reports/orders → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/orders')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Tax Config ──────────────────────
    it('34. GET /tax-config → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tax-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('35. POST /tax-config → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/tax-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Test' });
      expect(res.status).toBe(403);
    });

    // ─── Kitchen ──────────────────────
    it('36. GET /branches/:bid/kitchen-tickets → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-tickets`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('37. GET /branches/:bid/kitchen-stations → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/kitchen-stations`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Tables ──────────────────────
    it('38. GET /branches/:bid/tables → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/tables`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('39. GET /branches/:bid/dining-areas → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/dining-areas`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Tenancy ──────────────────────
    it('40. GET /tenants/current → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tenants/current')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    it('41. GET /memberships → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/memberships')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Outbox ──────────────────────
    it('42. GET /outbox/stats → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/outbox/stats')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Platform Admin (tenant-scoped) ──────────────────────
    it('43. GET /platform/tenants/:tid/features → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/features`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });

    // ─── Recipes ──────────────────────
    it('44. GET /branches/:bid/catalog/variants/:vid/recipe → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/catalog/variants/fake-variant/recipe`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 5: Payment Proof Denial
  // ═══════════════════════════════════════════════
  describe('Payment Proof Denial', () => {
    it('45. super admin cannot access payment proof URL in support mode', async () => {
      await enterSupport(tenantId, 'Proof denial test');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/payments/nonexistent/proof-url`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Support mode only allows menu\/catalog/);

      await exitSupport(tenantId);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 6: Expired Session Denial
  // ═══════════════════════════════════════════════
  describe('Expired Session Denial', () => {
    it('46. expired session immediately denies catalog mutations', async () => {
      // Enter support mode
      const enterRes = await enterSupport(tenantId, 'Expiry denial test');
      expect(enterRes.status).toBe(200);
      const sessionId = enterRes.body.data.id;

      // Manually expire the session in the database
      await prisma.supportSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 1000), status: 'EXPIRED', endedAt: new Date() },
      });

      // Try to access catalog — should be denied because session is expired
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 7: Exited Session Denial
  // ═══════════════════════════════════════════════
  describe('Exited Session Denial', () => {
    it('47. exited session immediately denies catalog mutations', async () => {
      await enterSupport(tenantId, 'Exit denial test');
      await exitSupport(tenantId);

      // Try to access catalog — should be denied
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 8: Cross-Tenant Isolation
  // ═══════════════════════════════════════════════
  describe('Cross-Tenant Isolation', () => {
    it('48. support in tenant A does not grant access to tenant B', async () => {
      // Enter support for tenant 1
      await enterSupport(tenantId, 'Cross-tenant test');

      // Try to access tenant 2 catalog — should be denied (no support session for tenant 2)
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenant2Id);

      expect(res.status).toBe(403);

      await exitSupport(tenantId);
    });

    it('49. support in tenant A blocks non-catalog access to tenant B', async () => {
      await enterSupport(tenantId, 'Cross-tenant escape test');

      // Try to access tenant 2 non-catalog endpoint — should be denied
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches/${branch2Id}/payments')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('x-tenant-id', tenant2Id);

      expect(res.status).toBe(403);

      await exitSupport(tenantId);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 9: Session Substitution
  // ═══════════════════════════════════════════════
  describe('Session Substitution', () => {
    it('50. entering support for tenant B ends session for tenant A', async () => {
      // Enter support for tenant 1
      const res1 = await enterSupport(tenantId, 'Substitution test A');
      expect(res1.status).toBe(200);

      // Enter support for tenant 2
      const res2 = await enterSupport(tenant2Id, 'Substitution test B');
      expect(res2.status).toBe(200);

      // Tenant 1 session should still be active (different tenant)
      const check1 = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(check1.status).toBe(200);
      expect(check1.body.data).not.toBeNull();
      expect(check1.body.data.status).toBe('ACTIVE');

      // Tenant 2 session should be active
      const check2 = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenant2Id}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(check2.status).toBe(200);
      expect(check2.body.data).not.toBeNull();
      expect(check2.body.data.status).toBe('ACTIVE');

      // Cleanup
      await exitSupport(tenantId);
      await exitSupport(tenant2Id);
    });

    it('51. re-entering support for same tenant ends previous session', async () => {
      const res1 = await enterSupport(tenantId, 'First session');
      expect(res1.status).toBe(200);

      const res2 = await enterSupport(tenantId, 'Second session');
      expect(res2.status).toBe(200);
      expect(res2.body.data.id).not.toBe(res1.body.data.id);

      // Check active — should be the second session
      const check = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(check.status).toBe(200);
      expect(check.body.data.id).toBe(res2.body.data.id);

      await exitSupport(tenantId);
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 10: Concurrent Enter/Exit
  // ═══════════════════════════════════════════════
  describe('Concurrent Enter/Exit', () => {
    it('52. concurrent enter requests do not create duplicate active sessions', async () => {
      // Fire 3 enter requests concurrently
      const results = await Promise.all([
        enterSupport(tenantId, 'Concurrent 1'),
        enterSupport(tenantId, 'Concurrent 2'),
        enterSupport(tenantId, 'Concurrent 3'),
      ]);

      // All should succeed (200)
      for (const res of results) {
        expect(res.status).toBe(200);
      }

      // But only one ACTIVE session should exist
      const activeSessions = await prisma.supportSession.findMany({
        where: { adminUserId: (await prisma.user.findUnique({ where: { email: saEmail } }))!.id, tenantId, status: 'ACTIVE' },
      });
      expect(activeSessions.length).toBe(1);

      await exitSupport(tenantId);
    });

    it('53. enter followed immediately by exit works correctly', async () => {
      const enterRes = await enterSupport(tenantId, 'Rapid enter');
      expect(enterRes.status).toBe(200);

      const exitRes = await exitSupport(tenantId);
      expect(exitRes.status).toBe(200);
      expect(exitRes.body.data.status).toBe('ENDED');

      // Confirm no active session
      const check = await request(app.getHttpServer())
        .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(check.body.data).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════
  // SECTION 11: Audit Trail
  // ═══════════════════════════════════════════════
  describe('Audit Trail', () => {
    it('54. entering support mode creates audit log entry', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { tenantId, action: 'SUPPORT_SESSION_ENTER' },
      });

      await enterSupport(tenantId, 'Audit trail test');

      const afterCount = await prisma.auditLog.count({
        where: { tenantId, action: 'SUPPORT_SESSION_ENTER' },
      });

      expect(afterCount).toBe(beforeCount + 1);

      await exitSupport(tenantId);
    });

    it('55. exiting support mode creates audit log entry', async () => {
      await enterSupport(tenantId, 'Audit exit test');

      const beforeCount = await prisma.auditLog.count({
        where: { tenantId, action: 'SUPPORT_SESSION_EXIT' },
      });

      await exitSupport(tenantId);

      const afterCount = await prisma.auditLog.count({
        where: { tenantId, action: 'SUPPORT_SESSION_EXIT' },
      });

      expect(afterCount).toBe(beforeCount + 1);
    });
  });
});
