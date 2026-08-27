import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

describe('Inventory & Batch Management (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let otherTenantId: string;
  let otherBranchId: string;
  let otherOwnerToken: string;
  let variantId: string;

  let itemId: string;
  let recipeItemId: string;

  const ts = Date.now();
  const ownerEmail = `inv-owner-${ts}@test.com`;
  const managerEmail = `inv-manager-${ts}@test.com`;
  const cashierEmail = `inv-cashier-${ts}@test.com`;
  const otherOwnerEmail = `inv-other-${ts}@test.com`;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: 'Test1234!' });
    if (!res.body?.data?.accessToken) throw new Error(`Login failed for ${email}`);
    return res.body.data.accessToken;
  };

  const auth = (token: string) => ({ auth: `Bearer ${token}`, tenant: tenantId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: 'InvTest', slug: `inv-test-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);
    await prisma.tenantEntitlement.update({
      where: { tenantId_featureKey: { tenantId, featureKey: 'BATCH_INVENTORY' } },
      data: { status: 'ENABLED' },
    });

    const branch = await prisma.branch.create({ data: { tenantId, name: 'Main', slug: `main-${ts}`, isActive: true } });
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

    const otherTenant = await prisma.tenant.create({ data: { name: 'InvOther', slug: `inv-other-${ts}`, status: 'ACTIVE' } });
    otherTenantId = otherTenant.id;
    await seedEntitlements(prisma, otherTenantId);
    const otherBranch = await prisma.branch.create({ data: { tenantId: otherTenantId, name: 'OtherMain', slug: `other-main-${ts}`, isActive: true } });
    otherBranchId = otherBranch.id;
    const otherOwner = await prisma.user.create({ data: { email: otherOwnerEmail, passwordHash, displayName: 'OtherOwner', status: 'ACTIVE' } });
    const oom = await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: otherOwner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId: otherTenantId, branchId: otherBranchId, membershipId: oom.id } });

    ownerToken = await login(ownerEmail);
    managerToken = await login(managerEmail);
    cashierToken = await login(cashierEmail);
    otherOwnerToken = await login(otherOwnerEmail);

    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Food', sortOrder: 0, isActive: true } });
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId: category.id, name: 'Burger', description: 'Tasty', isActive: true } });
    const variant = await prisma.menuItemVariant.create({ data: { tenantId, name: 'Regular', sku: `BURG-${ts}`, basePriceMinor: 25000n, isActive: true, menuItem: { connect: { id: item.id } } } });
    variantId = variant.id;

    // Create inventory items used across tests via API so they get proper branch scoping
    const itemRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/inventory/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Tomatoes', sku: 'TOM-001', baseUnit: 'kg', lowStockThreshold: 5 });
    itemId = itemRes.body.id;

    const bunRes = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/inventory/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Bun', baseUnit: 'pcs' });
    recipeItemId = bunRes.body.id;
  });

  afterAll(async () => {
    await cleanupEntitlements(prisma, tenantId);
    await cleanupEntitlements(prisma, otherTenantId);
    await prisma.featureSetting.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.recipeComponent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.recipe.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.branchAssignment.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [ownerEmail, managerEmail, cashierEmail, otherOwnerEmail] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, managerEmail, cashierEmail, otherOwnerEmail] } } });
    await prisma.menuItemVariant.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.menuItem.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.menuCategory.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.inventoryMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.inventoryBatch.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.inventoryItem.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.branch.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
    if (app) await app.close();
  });

  // ─── Inventory Items CRUD ─────────────────────

  describe('Inventory Items CRUD', () => {
    it('owner can create an inventory item', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Lettuce', baseUnit: 'g' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Lettuce');
    });

    it('manager can create an inventory item', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Cheese', baseUnit: 'g' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Cheese');
    });

    it('cashier is denied creating inventory items', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Onions', baseUnit: 'kg' });

      expect(res.status).toBe(403);
    });

    it('rejects unknown unit', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Widget', baseUnit: 'widget' });

      expect(res.status).toBe(400);
    });

    it('owner can list inventory items', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('owner can update an inventory item', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/inventory/items/${itemId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Organic Tomatoes', lowStockThreshold: 10 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Organic Tomatoes');
      expect(res.body.lowStockThreshold).toBe('10');
    });

    it('returns 404 for missing item', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/inventory/items/nonexistent`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Nope' });

      expect(res.status).toBe(404);
    });

    it('manager cross-branch access is denied', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${otherBranchId}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);
    });

    it('cross-tenant access is denied', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${otherOwnerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);
    });
  });

  // ─── Batch Receiving ──────────────────────

  describe('Batch Receiving', () => {
    it('owner can receive a batch', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          batchCode: 'BATCH-001',
          receivedQuantity: 50,
          unit: 'kg',
          costMinor: 5000,
          idempotencyKey: `recv-${ts}-1`,
        });

      expect(res.status).toBe(201);
      expect(res.body.batch.batchCode).toBe('BATCH-001');
      expect(res.body.movement.movementType).toBe('RECEIVE');
      expect(res.body.idempotent).toBe(false);
    });

    it('manager can receive a batch', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          batchCode: 'BATCH-002',
          receivedQuantity: 30,
          unit: 'kg',
          idempotencyKey: `recv-${ts}-2`,
        });

      expect(res.status).toBe(201);
    });

    it('cashier is denied batch receiving', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ batchCode: 'BATCH-X', receivedQuantity: 10, unit: 'kg' });

      expect(res.status).toBe(403);
    });

    it('rejects zero receivedQuantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ batchCode: 'BATCH-Z', receivedQuantity: 0, unit: 'kg' });

      expect(res.status).toBe(400);
    });

    it('rejects incompatible units (ml for kg item)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ batchCode: 'BATCH-BAD', receivedQuantity: 10, unit: 'ml' });

      expect(res.status).toBe(400);
    });

    it('idempotent: same key replays', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          batchCode: 'BATCH-001-DUP',
          receivedQuantity: 999,
          unit: 'kg',
          idempotencyKey: `recv-${ts}-1`,
        });

      expect(res.status).toBe(201);
      expect(res.body.idempotent).toBe(true);
      expect(res.body.batch.batchCode).toBe('BATCH-001');
    });

    it('returns 404 for missing item', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/nonexistent/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ batchCode: 'X', receivedQuantity: 10, unit: 'kg' });

      expect(res.status).toBe(404);
    });
  });

  // ─── Movement Ledger ──────────────────────

  describe('Movement Ledger', () => {
    it('lists movements for an item', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items/${itemId}/movements`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.movements.length).toBeGreaterThanOrEqual(2);
      expect(res.body.movements[0].movementType).toBe('RECEIVE');
    });

    it('filters by movementType', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items/${itemId}/movements?movementType=DEDUCT`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.movements).toHaveLength(0);
    });
  });

  // ─── Adjustments ──────────────────────────

  describe('Stock Adjustments', () => {
    it('owner can record a positive adjustment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/adjustments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 10, unit: 'kg', reason: 'Stock count correction', idempotencyKey: `adj-${ts}-1` });

      expect(res.status).toBe(201);
      expect(res.body.movement.movementType).toBe('ADJUST');
    });

    it('rejects zero adjustment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/adjustments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 0, unit: 'kg', reason: 'Zero' });

      expect(res.status).toBe(400);
    });

    it('cashier is denied adjustments', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/adjustments`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 5, unit: 'kg', reason: 'Nope' });

      expect(res.status).toBe(403);
    });

    it('idempotent adjustment replays', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/adjustments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 999, unit: 'kg', reason: 'Dup', idempotencyKey: `adj-${ts}-1` });

      expect(res.status).toBe(201);
      expect(res.body.idempotent).toBe(true);
    });
  });

  // ─── Waste ────────────────────────────────

  describe('Waste Recording', () => {
    it('owner can record waste', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/waste`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 2, unit: 'kg', reason: 'Spoiled', idempotencyKey: `waste-${ts}-1` });

      expect(res.status).toBe(201);
      expect(res.body.movement.movementType).toBe('WASTE');
    });

    it('rejects zero waste', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/waste`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 0, unit: 'kg', reason: 'Zero' });

      expect(res.status).toBe(400);
    });

    it('cashier is denied waste recording', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/waste`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 1, unit: 'kg', reason: 'Nope' });

      expect(res.status).toBe(403);
    });
  });

  // ─── Recipes ──────────────────────────────

  describe('Recipes', () => {
    it('owner can create a recipe', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          name: 'Burger Recipe',
          components: [
            { inventoryItemId: recipeItemId, quantity: 2, unit: 'pcs' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Burger Recipe');
      expect(res.body.version).toBe(1);
      expect(res.body.components).toHaveLength(1);
    });

    it('updating recipe increments version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({
          name: 'Burger Recipe v2',
          components: [
            { inventoryItemId: recipeItemId, quantity: 3, unit: 'pcs' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      expect(res.body.name).toBe('Burger Recipe v2');
    });

    it('owner can get a recipe', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Burger Recipe v2');
    });

    it('returns empty/null for variant without recipe', async () => {
      const mi = await prisma.menuItem.findFirst({ where: { tenantId } });
      const v = await prisma.menuItemVariant.create({
        data: { tenantId, name: 'NoRecipe', sku: `NR-${ts}`, basePriceMinor: 10000n, isActive: true, menuItem: { connect: { id: mi!.id } } },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/catalog/variants/${v.id}/recipe`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(!res.body || Object.keys(res.body).length === 0 || res.body === null).toBe(true);
    });

    it('rejects empty components', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Empty', components: [] });

      expect(res.status).toBe(409);
    });

    it('cashier is denied recipe mutation', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ name: 'Nope', components: [{ inventoryItemId: recipeItemId, quantity: 1, unit: 'pcs' }] });

      expect(res.status).toBe(403);
    });
  });

  // ─── Low-Stock Alerts ────────────────────

  describe('Low-Stock Alerts', () => {
    it('returns alerts for items below threshold', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/alerts`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(200);
      expect(res.body.alerts).toBeDefined();
    });
  });

  // ─── Feature Entitlement Gating ───────────

  describe('Feature Entitlement Gating', () => {
    it('blocks inventory endpoints when INVENTORY is disabled at tenant level', async () => {
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'INVENTORY' } },
        data: { status: 'DISABLED' },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/items`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(403);

      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'INVENTORY' } },
        data: { status: 'ENABLED' },
      });
    });

    it('blocks batch endpoints when BATCH_INVENTORY is disabled', async () => {
      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'BATCH_INVENTORY' } },
        data: { status: 'DISABLED' },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ batchCode: 'X', receivedQuantity: 10, unit: 'kg' });

      expect(res.status).toBe(403);

      await prisma.tenantEntitlement.update({
        where: { tenantId_featureKey: { tenantId, featureKey: 'BATCH_INVENTORY' } },
        data: { status: 'ENABLED' },
      });
    });
  });

  // ─── Ledger Immutability ─────────────────

  describe('Ledger Immutability', () => {
    it('cannot update an inventory movement via PATCH', async () => {
      const movs = await prisma.inventoryMovement.findMany({
        where: { tenantId, branchId, inventoryItemId: itemId },
        take: 1,
      });
      if (movs.length === 0) return;

      const movementId = movs[0].id;
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/inventory/items/${itemId}/movements/${movementId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ quantity: 99999 });

      expect(res.status).toBe(404);
    });

    it('cannot delete an inventory movement', async () => {
      const movs = await prisma.inventoryMovement.findMany({
        where: { tenantId, branchId, inventoryItemId: itemId },
        take: 1,
      });
      if (movs.length === 0) return;

      const movementId = movs[0].id;
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branchId}/inventory/items/${itemId}/movements/${movementId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId);

      expect(res.status).toBe(404);
    });
  });
});
