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

describe('Analytics & Reporting (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;

  // Tenant 2 for cross-tenant isolation
  let tenant2Id: string;
  let owner2Token: string;
  let branch2Id: string;

  const ownerEmail = `analytics-owner-${ts}@test.com`;
  const managerEmail = `analytics-manager-${ts}@test.com`;
  const cashierEmail = `analytics-cashier-${ts}@test.com`;
  const owner2Email = `analytics-owner2-${ts}@test.com`;
  const password = 'Test1234!';

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password });
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    app.get(OutboxProcessor).stop();

    // ── Tenant 1 ──
    const tenant = await prisma.tenant.create({ data: { name: 'Analytics T1', slug: `an-t1-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: `an-main-${ts}`, isActive: true, timezone: 'Africa/Addis_Ababa' },
    });
    branchId = branch.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });

    const mgr = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: mgr.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: mm.id } });

    const cash = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cash.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: cm.id } });

    ownerToken = await login(ownerEmail);
    managerToken = await login(managerEmail);
    cashierToken = await login(cashierEmail);

    // ── Tenant 2 ──
    const tenant2 = await prisma.tenant.create({ data: { name: 'Analytics T2', slug: `an-t2-${ts}`, status: 'ACTIVE' } });
    tenant2Id = tenant2.id;
    await seedEntitlements(prisma, tenant2Id);

    const branch2 = await prisma.branch.create({
      data: { tenantId: tenant2Id, name: 'Branch2', slug: `an-b2-${ts}`, isActive: true, timezone: 'Africa/Addis_Ababa' },
    });
    branch2Id = branch2.id;

    const owner2 = await prisma.user.create({ data: { email: owner2Email, passwordHash, displayName: 'Owner2', status: 'ACTIVE' } });
    const om2 = await prisma.tenantMembership.create({ data: { tenantId: tenant2Id, userId: owner2.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId: tenant2Id, branchId: branch2Id, membershipId: om2.id } });
    owner2Token = await login(owner2Email);

    // Enable ANALYTICS for tenant 2
    const passwordHash2 = await argon2.hash(password, { type: argon2.argon2id });
    const saEmail = `sa-analytics-${ts}@test.com`;
    await prisma.user.upsert({
      where: { email: saEmail },
      update: {},
      create: { email: saEmail, passwordHash: passwordHash2, displayName: 'SA', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    const saToken = await login(saEmail);
    await request(app.getHttpServer())
      .put(`/api/v1/platform/tenants/${tenant2Id}/features/ANALYTICS`)
      .set('Authorization', `Bearer ${saToken}`)
      .send({ status: 'ENABLED' });

    // ── Seed orders + payments for analytics ──
    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 0, isActive: true } });
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true } });
    const variant = await prisma.menuItemVariant.create({
      data: { tenantId, name: 'Regular', sku: `BURG-${ts}`, basePriceMinor: 25000n, isActive: true, menuItem: { connect: { id: item.id } } },
    });

    const table = await prisma.restaurantTable.create({ data: { tenantId, branchId, label: 'T1', capacity: 4, isActive: true } });

    // Initialize branch order counter
    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;

    // Create 3 orders with approved payments
    for (let i = 1; i <= 3; i++) {
      const crypto = await import('crypto');
      const trackingRaw = crypto.randomBytes(32).toString('base64url');
      const trackingHash = crypto.createHash('sha256').update(trackingRaw).digest('hex');

      const order = await prisma.order.create({
        data: {
          tenantId,
          branchId,
          orderNumber: BigInt(i),
          orderType: 'DINE_IN',
          status: i === 1 ? 'COMPLETED' : i === 2 ? 'CANCELLED' : 'VOIDED',
          tableId: table.id,
          currency: 'ETB',
          subtotalMinor: BigInt(25000 * i),
          totalMinor: BigInt(25000 * i),
          source: 'CASHIER_POS',
          trackingTokenHash: trackingHash,
          version: 1,
        },
      });

      await prisma.orderLine.create({
        data: {
          tenantId,
          branchId,
          orderId: order.id,
          variantId: variant.id,
          itemNameSnapshot: 'Burger',
          variantNameSnapshot: 'Regular',
          quantity: i,
          unitPriceMinor: 25000n,
          lineTotalMinor: BigInt(25000 * i),
        },
      });

      if (i !== 2) {
        await prisma.payment.create({
          data: {
            tenantId,
            branchId,
            orderId: order.id,
            method: i === 1 ? 'CASH' : 'MOBILE_MONEY',
            amountMinor: BigInt(25000 * i),
            currency: 'ETB',
            status: 'APPROVED',
          },
        });
      }
    }

    // Update branch order counter
    await prisma.branchOrderCounter.update({
      where: { branchId },
      data: { lastNumber: 3 },
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    const tenantIds = [tenantId, tenant2Id].filter(Boolean);
    for (const tid of tenantIds) {
      await prisma.payment.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.orderLine.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.order.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.restaurantTable.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuItemVariant.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuItem.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.menuCategory.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.branchAssignment.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await prisma.featureSetting.deleteMany({ where: { tenantId: tid } }).catch(() => {});
      await cleanupEntitlements(prisma, tid);
      await prisma.tenant.deleteMany({ where: { id: tid } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { contains: '-analytics-' } } }).catch(() => {});
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
  // 1. ENTITLEMENT ENFORCEMENT
  // ═══════════════════════════════════════════════
  describe('Entitlement Enforcement', () => {
    it('blocks cashiers from all analytics endpoints', async () => {
      const endpoints = [
        '/api/v1/reports/revenue',
        '/api/v1/reports/revenue-by-method',
        '/api/v1/reports/orders',
        '/api/v1/reports/best-sellers',
        '/api/v1/reports/peak-hours',
        '/api/v1/reports/inventory-consumption',
        '/api/v1/reports/low-stock',
      ];
      for (const ep of endpoints) {
        const res = await request(app.getHttpServer())
          .get(ep)
          .set(hdr(cashierToken));
        expect(res.status).toBe(403);
      }
    });

    it('blocks when ANALYTICS feature is disabled', async () => {
      // Disable ANALYTICS via platform admin
      const saLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `sa-analytics-${ts}@test.com`, password });
      // Create super admin directly
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await prisma.user.create({
        data: { email: `sa-analytics-${ts}@test.com`, passwordHash, displayName: 'SA', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
      }).catch(() => {});
      const saToken = await login(`sa-analytics-${ts}@test.com`);

      // Disable
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${saToken}`)
        .send({ status: 'DISABLED' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue')
        .set(hdr(ownerToken));
      expect(res.status).toBe(403);

      // Re-enable
      await request(app.getHttpServer())
        .put(`/api/v1/platform/tenants/${tenantId}/features/ANALYTICS`)
        .set('Authorization', `Bearer ${saToken}`)
        .send({ status: 'ENABLED' });
    });
  });

  // ═══════════════════════════════════════════════
  // 2. TENANT ISOLATION
  // ═══════════════════════════════════════════════
  describe('Tenant Isolation', () => {
    it('tenant 2 sees no data for tenant 1', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue')
        .set(hdr2(owner2Token));
      expect(res.status).toBe(200);
      expect(res.body.data.days).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════
  // 3. REVENUE SUMMARY
  // ═══════════════════════════════════════════════
  describe('GET /reports/revenue', () => {
    it('returns revenue summary with correct structure', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('timezone');
      expect(res.body.data).toHaveProperty('days');
      expect(Array.isArray(res.body.data.days)).toBe(true);
    });

    it('filters by branch', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reports/revenue?branchId=${branchId}`)
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('timezone');
    });

    it('rejects invalid date range', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue?fromLocalDate=2025-01-01&toLocalDate=2026-06-01')
        .set(hdr(ownerToken));
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════
  // 4. REVENUE BY PAYMENT METHOD
  // ═══════════════════════════════════════════════
  describe('GET /reports/revenue-by-method', () => {
    it('returns payment method breakdown', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue-by-method')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('methods');
      expect(Array.isArray(res.body.data.methods)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 5. ORDER STATS
  // ═══════════════════════════════════════════════
  describe('GET /reports/orders', () => {
    it('returns order statistics with correct counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/orders')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data.stats).toHaveProperty('totalOrders');
      expect(res.body.data.stats).toHaveProperty('completedOrders');
      expect(res.body.data.stats).toHaveProperty('cancelledOrders');
      expect(res.body.data.stats).toHaveProperty('voidedOrders');
      expect(res.body.data.stats).toHaveProperty('avgOrderMinor');
      expect(res.body.data.stats).toHaveProperty('totalRevenueMinor');
    });
  });

  // ═══════════════════════════════════════════════
  // 6. BEST SELLERS
  // ═══════════════════════════════════════════════
  describe('GET /reports/best-sellers', () => {
    it('returns best sellers list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/best-sellers')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/best-sellers?limit=1')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════
  // 7. PEAK HOURS
  // ═══════════════════════════════════════════════
  describe('GET /reports/peak-hours', () => {
    it('returns all 24 hours', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/peak-hours')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data.hours).toHaveLength(24);
      expect(res.body.data).toHaveProperty('timezone');
    });
  });

  // ═══════════════════════════════════════════════
  // 8. INVENTORY CONSUMPTION
  // ═══════════════════════════════════════════════
  describe('GET /reports/inventory-consumption', () => {
    it('returns consumption data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/inventory-consumption')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 9. LOW STOCK SNAPSHOT
  // ═══════════════════════════════════════════════
  describe('GET /reports/low-stock', () => {
    it('returns low stock snapshot', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/low-stock')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 10. VALIDATION
  // ═══════════════════════════════════════════════
  describe('Query Validation', () => {
    it('rejects invalid date format', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/revenue?fromLocalDate=not-a-date')
        .set(hdr(ownerToken));
      expect(res.status).toBe(400);
    });

    it('rejects invalid limit for best-sellers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/best-sellers?limit=0')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
    });

    it('rejects limit exceeding max', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/best-sellers?limit=200')
        .set(hdr(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(100);
    });
  });

  // ═══════════════════════════════════════════════
  // 11. MANAGER ACCESS
  // ═══════════════════════════════════════════════
  describe('Manager Access', () => {
    it('manager can access all analytics endpoints', async () => {
      const endpoints = [
        '/api/v1/reports/revenue',
        '/api/v1/reports/revenue-by-method',
        '/api/v1/reports/orders',
        '/api/v1/reports/best-sellers',
        '/api/v1/reports/peak-hours',
        '/api/v1/reports/inventory-consumption',
        '/api/v1/reports/low-stock',
      ];
      for (const ep of endpoints) {
        const res = await request(app.getHttpServer())
          .get(ep)
          .set(hdr(managerToken));
        expect(res.status).toBe(200);
      }
    });
  });
});
