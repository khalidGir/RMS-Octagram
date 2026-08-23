import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';
import { OrdersService } from '../src/modules/orders/orders.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

describe('Inventory Critical Acceptance Scenarios (e2e)', () => {
  let app: any;
  let ordersService: OrdersService;
  let ownerToken: string;
  let tenantId: string;
  let branchId: string;
  let ownerUserId: string;
  let category: { id: string };

  const ts = Date.now();
  const ownerEmail = `crit-owner-${ts}@test.com`;
  const cashierEmail = `crit-cashier-${ts}@test.com`;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: 'Test1234!' });
    if (!res.body?.data?.accessToken) throw new Error(`Login failed for ${email}`);
    return res.body.data.accessToken;
  };

  const hdrs = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'x-tenant-id': tenantId,
  });

  const createItem = async (name: string, unit: string, threshold = 0) => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/inventory/items`)
      .set(hdrs(ownerToken))
      .send({ name, baseUnit: unit, lowStockThreshold: threshold });
    expect(res.status).toBe(201);
    return res.body as { id: string; name: string };
  };

  const receiveBatch = async (
    itemId: string,
    batchCode: string,
    quantity: number,
    unit: string,
    expiresAt?: string,
    idempKey?: string,
  ) => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/inventory/items/${itemId}/batches`)
      .set(hdrs(ownerToken))
      .send({
        batchCode,
        receivedQuantity: quantity,
        unit,
        expiresAt,
        idempotencyKey: idempKey ?? `recv-${batchCode}-${ts}`,
      });
    expect(res.status).toBe(201);
    return res.body as {
      batch: { id: string; batchCode: string; remainingQuantity: string };
      movement: { id: string; movementType: string };
      idempotent: boolean;
    };
  };

  const createVariant = async (name: string, sku: string, priceMinor: bigint) => {
    const item = await prisma.menuItem.create({
      data: { tenantId, categoryId: category.id, name, description: name, isActive: true },
    });
    return prisma.menuItemVariant.create({
      data: {
        tenantId,
        name,
        sku,
        basePriceMinor: priceMinor,
        isActive: true,
        menuItem: { connect: { id: item.id } },
      },
    });
  };

  const upsertRecipe = async (
    variantId: string,
    components: Array<{ inventoryItemId: string; quantity: number; unit: string }>,
  ) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branchId}/catalog/variants/${variantId}/recipe`)
      .set(hdrs(ownerToken))
      .send({ name: `Recipe-${variantId.slice(0, 8)}`, components });
    expect(res.status).toBe(200);
    return res.body;
  };

  const createOrder = async (
    lines: Array<{ variantId: string; quantity: number }>,
  ) => {
    const key = `order-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/orders`)
      .set(hdrs(ownerToken))
      .send({ lines, orderType: 'POS', idempotencyKey: key });
    expect(res.status).toBe(201);
    return (res.body.data?.order ?? res.body.data) as { id: string; status: string; version: number };
  };

  const createCashPayment = async (orderId: string) => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId)
      .send({ orderId, idempotencyKey: `cash-${orderId}-${ts}` });
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  };

  const confirmCash = async (paymentId: string) => {
    return request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/payments/${paymentId}/confirm-cash`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', tenantId);
  };

  const getMovements = async (itemId: string, type?: string) => {
    const qs = type ? `?movementType=${type}` : '';
    const res = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchId}/inventory/items/${itemId}/movements${qs}`)
      .set(hdrs(ownerToken));
    expect(res.status).toBe(200);
    return res.body.movements as Array<{
      id: string;
      batchId: string;
      quantity: string;
      movementType: string;
      inventoryItemId: string;
    }>;
  };

  const getOrder = async (orderId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set(hdrs(ownerToken));
    expect(res.status).toBe(200);
    return res.body.data as { id: string; status: string; version: number };
  };

  const paymentId = (p: { data?: { id: string }; id?: string }) => p.data?.id ?? p.id!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    ordersService = app.get(OrdersService);

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({
      data: { name: 'CritTest', slug: `crit-test-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);
    await prisma.tenantEntitlement.update({
      where: { tenantId_featureKey: { tenantId, featureKey: 'BATCH_INVENTORY' } },
      data: { status: 'ENABLED' },
    });

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main', slug: `crit-main-${ts}`, isActive: true },
    });
    branchId = branch.id;

    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    ownerUserId = owner.id;
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

    ownerToken = await login(ownerEmail);

    category = await prisma.menuCategory.create({
      data: { tenantId, name: 'Food', sortOrder: 0, isActive: true },
    });

    await prisma.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 0, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.inventoryBatch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.inventoryItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.recipeComponent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.recipe.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLineModifier.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.idempotencyRecord.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItemVariant.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, tenantId);
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [ownerEmail, cashierEmail] } } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, cashierEmail] } } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
    if (app) await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. ORDER CONFIRMATION DEDUCTS INVENTORY ATOMICALLY
  // ═══════════════════════════════════════════════════════════════════

  describe('1. Atomic Deduction on Order Confirmation', () => {
    let tomatoId: string;
    let bunId: string;
    let burgerVariant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-Atomic', 'kg');
      tomatoId = t.id;
      const b = await createItem('Bun-Atomic', 'pcs');
      bunId = b.id;
      burgerVariant = await createVariant('Burger-Atomic', `BA-${ts}`, 25000n);

      await upsertRecipe(burgerVariant.id, [
        { inventoryItemId: tomatoId, quantity: 2, unit: 'kg' },
        { inventoryItemId: bunId, quantity: 3, unit: 'pcs' },
      ]);

      await receiveBatch(tomatoId, 'BA-TOM', 20, 'kg', undefined, `recv-ba-tom-${ts}`);
      await receiveBatch(bunId, 'BA-BUN', 50, 'pcs', undefined, `recv-ba-bun-${ts}`);
    });

    it('cash confirm triggers CONFIRMED, creates movements, decrements batches', async () => {
      const order = await createOrder([{ variantId: burgerVariant.id, quantity: 2 }]);

      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const orderAfter = await getOrder(order.id);
      expect(orderAfter.status).toBe('CONFIRMED');

      const tomatoMovs = await getMovements(tomatoId, 'DEDUCT');
      const tomatoTotal = tomatoMovs.reduce((s, m) => s + Number(m.quantity), 0);
      expect(tomatoTotal).toBe(4);

      const bunMovs = await getMovements(bunId, 'DEDUCT');
      const bunTotal = bunMovs.reduce((s, m) => s + Number(m.quantity), 0);
      expect(bunTotal).toBe(6);

      const tomatoBatch = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId },
      });
      expect(Number(tomatoBatch!.remainingQuantity)).toBe(16);

      const bunBatch = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: bunId },
      });
      expect(Number(bunBatch!.remainingQuantity)).toBe(44);

      const payment = await prisma.payment.findFirst({
        where: { tenantId, branchId, orderId: order.id },
      });
      expect(payment!.status).toBe('APPROVED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. FIFO ACROSS MULTIPLE BATCHES
  // ═══════════════════════════════════════════════════════════════════

  describe('2. FIFO Consumption Across Multiple Batches', () => {
    let tomatoId: string;
    let variant: any;
    let batchAId: string;
    let batchBId: string;
    let batchCId: string;

    beforeAll(async () => {
      const t = await createItem('Tomato-FIFO', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-FIFO', `BF-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 1, unit: 'kg' },
      ]);

      const ba = await receiveBatch(tomatoId, 'FIFO-A', 5, 'kg', undefined, `recv-fifo-a-${ts}`);
      batchAId = ba.batch.id;
      await new Promise((r) => setTimeout(r, 30));
      const bb = await receiveBatch(tomatoId, 'FIFO-B', 10, 'kg', undefined, `recv-fifo-b-${ts}`);
      batchBId = bb.batch.id;
      await new Promise((r) => setTimeout(r, 30));
      const bc = await receiveBatch(tomatoId, 'FIFO-C', 8, 'kg', undefined, `recv-fifo-c-${ts}`);
      batchCId = bc.batch.id;
    });

    it('deducts oldest batch first, then next, leaves newest untouched', async () => {
      const order = await createOrder([{ variantId: variant.id, quantity: 7 }]);
      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const batchA = await prisma.inventoryBatch.findUnique({ where: { id: batchAId } });
      expect(Number(batchA!.remainingQuantity)).toBe(0);

      const batchB = await prisma.inventoryBatch.findUnique({ where: { id: batchBId } });
      expect(Number(batchB!.remainingQuantity)).toBe(8);

      const batchC = await prisma.inventoryBatch.findUnique({ where: { id: batchCId } });
      expect(Number(batchC!.remainingQuantity)).toBe(8);

      const movements = await getMovements(tomatoId, 'DEDUCT');
      const batchIds = movements.map((m) => m.batchId);
      expect(batchIds).toContain(batchAId);
      expect(batchIds).toContain(batchBId);
      expect(batchIds).not.toContain(batchCId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. EXPIRED BATCHES ARE EXCLUDED
  // ═══════════════════════════════════════════════════════════════════

  describe('3. Expired Batches Are Excluded', () => {
    let tomatoId: string;
    let variant: any;
    let expiredBatchId: string;
    let freshBatchId: string;

    beforeAll(async () => {
      const t = await createItem('Tomato-Expired', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-Expired', `BE-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 1, unit: 'kg' },
      ]);

      const expired = await receiveBatch(
        tomatoId, 'EXPIRED-BAT', 10, 'kg',
        '2020-01-01T00:00:00.000Z', `recv-exp-${ts}`,
      );
      expiredBatchId = expired.batch.id;

      const fresh = await receiveBatch(
        tomatoId, 'FRESH-BAT', 10, 'kg',
        '2030-12-31T23:59:59.000Z', `recv-fresh-${ts}`,
      );
      freshBatchId = fresh.batch.id;
    });

    it('only deducts from fresh batch, expired batch untouched', async () => {
      const order = await createOrder([{ variantId: variant.id, quantity: 3 }]);
      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const expiredBatch = await prisma.inventoryBatch.findUnique({ where: { id: expiredBatchId } });
      expect(Number(expiredBatch!.remainingQuantity)).toBe(10);

      const freshBatch = await prisma.inventoryBatch.findUnique({ where: { id: freshBatchId } });
      expect(Number(freshBatch!.remainingQuantity)).toBe(7);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. MULTIPLE LINES AND COMPONENTS CALCULATED CORRECTLY
  // ═══════════════════════════════════════════════════════════════════

  describe('4. Multiple Lines and Components', () => {
    let tomatoId: string;
    let bunId: string;
    let cheeseId: string;
    let burgerVariant: any;
    let pizzaVariant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-Multi', 'kg');
      tomatoId = t.id;
      const b = await createItem('Bun-Multi', 'pcs');
      bunId = b.id;
      const c = await createItem('Cheese-Multi', 'pcs');
      cheeseId = c.id;

      burgerVariant = await createVariant('Burger-Multi', `BM-${ts}`, 25000n);
      pizzaVariant = await createVariant('Pizza-Multi', `PM-${ts}`, 35000n);

      await upsertRecipe(burgerVariant.id, [
        { inventoryItemId: tomatoId, quantity: 2, unit: 'kg' },
        { inventoryItemId: bunId, quantity: 3, unit: 'pcs' },
      ]);

      await upsertRecipe(pizzaVariant.id, [
        { inventoryItemId: tomatoId, quantity: 1, unit: 'kg' },
        { inventoryItemId: cheeseId, quantity: 5, unit: 'pcs' },
      ]);

      await receiveBatch(tomatoId, 'MULTI-TOM', 50, 'kg', undefined, `recv-multi-tom-${ts}`);
      await receiveBatch(bunId, 'MULTI-BUN', 100, 'pcs', undefined, `recv-multi-bun-${ts}`);
      await receiveBatch(cheeseId, 'MULTI-CHE', 100, 'pcs', undefined, `recv-multi-che-${ts}`);
    });

    it('3 Burgers + 2 Pizzas: 8kg tomato, 9pcs bun, 10pcs cheese', async () => {
      const order = await createOrder([
        { variantId: burgerVariant.id, quantity: 3 },
        { variantId: pizzaVariant.id, quantity: 2 },
      ]);
      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const tomatoMovs = await getMovements(tomatoId, 'DEDUCT');
      const tomatoTotal = tomatoMovs.reduce((s, m) => s + Number(m.quantity), 0);
      expect(tomatoTotal).toBe(8);

      const bunMovs = await getMovements(bunId, 'DEDUCT');
      const bunTotal = bunMovs.reduce((s, m) => s + Number(m.quantity), 0);
      expect(bunTotal).toBe(9);

      const cheeseMovs = await getMovements(cheeseId, 'DEDUCT');
      const cheeseTotal = cheeseMovs.reduce((s, m) => s + Number(m.quantity), 0);
      expect(cheeseTotal).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. INSUFFICIENT STOCK ROLLS BACK ENTIRE TRANSACTION
  // ═══════════════════════════════════════════════════════════════════

  describe('5. Insufficient Stock Rolls Back Everything', () => {
    let tomatoId: string;
    let variant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-Insuff', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-Insuff', `BI-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 5, unit: 'kg' },
      ]);

      await receiveBatch(tomatoId, 'INSUFF-BAT', 3, 'kg', undefined, `recv-insuff-${ts}`);
    });

    it('rejects confirmation, order stays PENDING_CONFIRMATION, payment stays PENDING, no deduction', async () => {
      const movCountBefore = await prisma.inventoryMovement.count({
        where: { tenantId, branchId, inventoryItemId: tomatoId, movementType: 'DEDUCT' },
      });

      const order = await createOrder([{ variantId: variant.id, quantity: 2 }]);
      const pay = await createCashPayment(order.id);
      const pid = paymentId(pay);

      const confirmRes = await confirmCash(pid);
      expect(confirmRes.status).toBeGreaterThanOrEqual(400);

      const orderAfter = await prisma.order.findUnique({ where: { id: order.id } });
      expect(orderAfter!.status).toBe('PENDING_CONFIRMATION');

      const paymentAfter = await prisma.payment.findUnique({ where: { id: pid } });
      expect(paymentAfter!.status).toBe('PENDING');

      const movCountAfter = await prisma.inventoryMovement.count({
        where: { tenantId, branchId, inventoryItemId: tomatoId, movementType: 'DEDUCT' },
      });
      expect(movCountAfter).toBe(movCountBefore);

      const batch = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId },
      });
      expect(Number(batch!.remainingQuantity)).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. CONCURRENT CONFIRMATIONS CANNOT OVERSELL
  // ═══════════════════════════════════════════════════════════════════

  describe('6. Concurrent Confirmations Cannot Oversell', () => {
    let tomatoId: string;
    let v1: any;
    let v2: any;
    let batchId: string;

    beforeAll(async () => {
      const t = await createItem('Tomato-Conc', 'kg');
      tomatoId = t.id;
      v1 = await createVariant('Burger-Conc1', `BC1-${ts}`, 25000n);
      v2 = await createVariant('Burger-Conc2', `BC2-${ts}`, 25000n);

      await upsertRecipe(v1.id, [{ inventoryItemId: tomatoId, quantity: 5, unit: 'kg' }]);
      await upsertRecipe(v2.id, [{ inventoryItemId: tomatoId, quantity: 5, unit: 'kg' }]);

      const b = await receiveBatch(tomatoId, 'CONC-BAT', 8, 'kg', undefined, `recv-conc-${ts}`);
      batchId = b.batch.id;
    });

    it('two concurrent 5kg orders on 8kg: batch never goes negative', async () => {
      const order1 = await createOrder([{ variantId: v1.id, quantity: 1 }]);
      const order2 = await createOrder([{ variantId: v2.id, quantity: 1 }]);

      const pay1 = await createCashPayment(order1.id);
      const pay2 = await createCashPayment(order2.id);

      await Promise.all([
        confirmCash(paymentId(pay1)),
        confirmCash(paymentId(pay2)),
      ]);

      const batchAfter = await prisma.inventoryBatch.findUnique({ where: { id: batchId } });
      expect(Number(batchAfter!.remainingQuantity)).toBeGreaterThanOrEqual(0);

      const order1After = await prisma.order.findUnique({ where: { id: order1.id } });
      const order2After = await prisma.order.findUnique({ where: { id: order2.id } });
      const confirmedCount = [order1After!.status, order2After!.status].filter(
        (s) => s === 'CONFIRMED',
      ).length;
      expect(confirmedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. DUPLICATE CONFIRMATION IS IDEMPOTENT
  // ═══════════════════════════════════════════════════════════════════

  describe('7. Duplicate Confirmation Creates No Duplicate Deductions', () => {
    let tomatoId: string;
    let variant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-Dup', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-Dup', `BD-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 2, unit: 'kg' },
      ]);

      await receiveBatch(tomatoId, 'DUP-BAT', 20, 'kg', undefined, `recv-dup-${ts}`);
    });

    it('confirming same payment twice does not double-deduct', async () => {
      const batchBefore = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId },
      });
      const remBefore = Number(batchBefore!.remainingQuantity);

      const movCountBefore = await prisma.inventoryMovement.count({
        where: { tenantId, branchId, inventoryItemId: tomatoId, movementType: 'DEDUCT' },
      });

      const order = await createOrder([{ variantId: variant.id, quantity: 1 }]);
      const pay = await createCashPayment(order.id);
      const pid = paymentId(pay);

      const res1 = await confirmCash(pid);
      expect(res1.status).toBe(200);

      const res2 = await confirmCash(pid);
      expect(res2.status).toBe(200);

      const batchAfter = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId, id: batchBefore!.id },
      });
      expect(Number(batchAfter!.remainingQuantity)).toBe(remBefore - 2);

      const movCountAfter = await prisma.inventoryMovement.count({
        where: { tenantId, branchId, inventoryItemId: tomatoId, movementType: 'DEDUCT' },
      });
      expect(movCountAfter).toBe(movCountBefore + 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. ORDER VOID RESTORES EXACT CONSUMED BATCHES
  // ═══════════════════════════════════════════════════════════════════

  describe('8. Order Void Restores Exact Originally Consumed Batches', () => {
    let tomatoId: string;
    let variant: any;
    let batchAId: string;
    let batchBId: string;

    beforeAll(async () => {
      const t = await createItem('Tomato-Void', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-Void', `BV-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 1, unit: 'kg' },
      ]);

      const ba = await receiveBatch(tomatoId, 'VOID-A', 3, 'kg', undefined, `recv-void-a-${ts}`);
      batchAId = ba.batch.id;
      await new Promise((r) => setTimeout(r, 20));
      const bb = await receiveBatch(tomatoId, 'VOID-B', 5, 'kg', undefined, `recv-void-b-${ts}`);
      batchBId = bb.batch.id;
    });

    it('void restores the exact batches consumed by the original deduction', async () => {
      const batchABefore = await prisma.inventoryBatch.findUnique({ where: { id: batchAId } });
      const batchBBefore = await prisma.inventoryBatch.findUnique({ where: { id: batchBId } });
      const remA = Number(batchABefore!.remainingQuantity);
      const remB = Number(batchBBefore!.remainingQuantity);

      const order = await createOrder([{ variantId: variant.id, quantity: 5 }]);
      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const batchAAfterDeduct = await prisma.inventoryBatch.findUnique({ where: { id: batchAId } });
      expect(Number(batchAAfterDeduct!.remainingQuantity)).toBe(0);

      const orderData = await getOrder(order.id);

      await ordersService.voidOrder({
        orderId: order.id,
        tenantId,
        branchId,
        actorUserId: ownerUserId,
        expectedVersion: orderData.version,
      });

      const batchAAfterVoid = await prisma.inventoryBatch.findUnique({ where: { id: batchAId } });
      expect(Number(batchAAfterVoid!.remainingQuantity)).toBe(remA);

      const batchBAfterVoid = await prisma.inventoryBatch.findUnique({ where: { id: batchBId } });
      expect(Number(batchBAfterVoid!.remainingQuantity)).toBe(remB);

      const voidMovements = await getMovements(tomatoId, 'VOID_RESTORE');
      expect(voidMovements.length).toBeGreaterThanOrEqual(1);

      const restoredBatches = voidMovements.map((m) => m.batchId);
      expect(restoredBatches).toContain(batchAId);
      expect(restoredBatches).toContain(batchBId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. DUPLICATE VOID IS IDEMPOTENT
  // ═══════════════════════════════════════════════════════════════════

  describe('9. Duplicate Void Creates No Duplicate Restoration', () => {
    let tomatoId: string;
    let variant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-DupVoid', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-DupVoid', `BDV-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 2, unit: 'kg' },
      ]);

      await receiveBatch(tomatoId, 'DUPVOID-BAT', 20, 'kg', undefined, `recv-dupvoid-${ts}`);
    });

    it('voiding same order twice does not double-restore', async () => {
      const batchBefore = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId },
      });
      const remBefore = Number(batchBefore!.remainingQuantity);

      const order = await createOrder([{ variantId: variant.id, quantity: 1 }]);
      const pay = await createCashPayment(order.id);
      const confirmRes = await confirmCash(paymentId(pay));
      expect(confirmRes.status).toBe(200);

      const orderAfterConfirm = await getOrder(order.id);

      await ordersService.voidOrder({
        orderId: order.id,
        tenantId,
        branchId,
        actorUserId: ownerUserId,
        expectedVersion: orderAfterConfirm.version,
      });

      const batchAfterFirstVoid = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId, id: batchBefore!.id },
      });
      expect(Number(batchAfterFirstVoid!.remainingQuantity)).toBe(remBefore);

      const orderAfterFirstVoid = await getOrder(order.id);

      await ordersService.voidOrder({
        orderId: order.id,
        tenantId,
        branchId,
        actorUserId: ownerUserId,
        expectedVersion: orderAfterFirstVoid.version,
      });

      const batchAfterSecondVoid = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId, id: batchBefore!.id },
      });
      expect(Number(batchAfterSecondVoid!.remainingQuantity)).toBe(remBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 10. RECIPE VERSION ISOLATION FROM HISTORICAL DEDUCTIONS
  // ═══════════════════════════════════════════════════════════════════

  describe('10. Recipe Version Changes Do Not Affect Historical Deductions', () => {
    let tomatoId: string;
    let variant: any;

    beforeAll(async () => {
      const t = await createItem('Tomato-RecipeVer', 'kg');
      tomatoId = t.id;
      variant = await createVariant('Burger-RecipeVer', `BRV-${ts}`, 25000n);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 2, unit: 'kg' },
      ]);

      await receiveBatch(tomatoId, 'RV-BAT', 50, 'kg', undefined, `recv-rv-${ts}`);
    });

    it('old order used old recipe, new order uses updated recipe amount', async () => {
      const order1 = await createOrder([{ variantId: variant.id, quantity: 1 }]);
      const pay1 = await createCashPayment(order1.id);
      const confirmRes1 = await confirmCash(paymentId(pay1));
      expect(confirmRes1.status).toBe(200);

      const movs1 = await getMovements(tomatoId, 'DEDUCT');
      const total1 = movs1.reduce((s, m) => s + Number(m.quantity), 0);
      expect(total1).toBe(2);

      await upsertRecipe(variant.id, [
        { inventoryItemId: tomatoId, quantity: 3, unit: 'kg' },
      ]);

      const batchMid = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId },
      });
      const remMid = Number(batchMid!.remainingQuantity);

      const order2 = await createOrder([{ variantId: variant.id, quantity: 1 }]);
      const pay2 = await createCashPayment(order2.id);
      const confirmRes2 = await confirmCash(paymentId(pay2));
      expect(confirmRes2.status).toBe(200);

      const batchAfter = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: tomatoId, id: batchMid!.id },
      });
      expect(Number(batchAfter!.remainingQuantity)).toBe(remMid - 3);

      const movsAfter = await getMovements(tomatoId, 'DEDUCT');
      const totalAfter = movsAfter.reduce((s, m) => s + Number(m.quantity), 0);
      expect(totalAfter).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. LOW-STOCK AT THRESHOLD BOUNDARY
  // ═══════════════════════════════════════════════════════════════════

  describe('11. Low-Stock at Threshold Boundary', () => {
    it('item at exactly threshold is low', async () => {
      const item = await createItem('At-Threshold', 'kg', 10);
      await receiveBatch(item.id, 'THRESH-10', 10, 'kg', undefined, `recv-thresh-${ts}`);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/alerts`)
        .set(hdrs(ownerToken));

      expect(res.status).toBe(200);
      const alert = res.body.alerts.find((a: any) => a.id === item.id);
      expect(alert).toBeDefined();
      expect(alert.isLow).toBe(true);
    });

    it('item above threshold is not low', async () => {
      const item = await createItem('Above-Threshold', 'kg', 10);
      await receiveBatch(item.id, 'ABOVE-15', 15, 'kg', undefined, `recv-above-${ts}`);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/alerts`)
        .set(hdrs(ownerToken));

      expect(res.status).toBe(200);
      const alert = res.body.alerts.find((a: any) => a.id === item.id);
      expect(alert).toBeUndefined();
    });

    it('item below threshold is low', async () => {
      const item = await createItem('Below-Threshold', 'kg', 10);
      await receiveBatch(item.id, 'BELOW-5', 5, 'kg', undefined, `recv-below-${ts}`);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchId}/inventory/alerts`)
        .set(hdrs(ownerToken));

      expect(res.status).toBe(200);
      const alert = res.body.alerts.find((a: any) => a.id === item.id);
      expect(alert).toBeDefined();
      expect(alert.isLow).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. DATABASE-LEVEL LEDGER IMMUTABILITY
  // ═══════════════════════════════════════════════════════════════════

  describe('12. Database-Level Ledger Immutability', () => {
    it('PATCH on a movement returns 404 (no such route)', async () => {
      const movs = await prisma.inventoryMovement.findMany({ where: { tenantId, branchId }, take: 1 });
      if (movs.length === 0) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/inventory/items/${movs[0].inventoryItemId}/movements/${movs[0].id}`)
        .set(hdrs(ownerToken))
        .send({ quantity: 99999 });
      expect(res.status).toBe(404);
    });

    it('DELETE on a movement returns 404 (no such route)', async () => {
      const movs = await prisma.inventoryMovement.findMany({ where: { tenantId, branchId }, take: 1 });
      if (movs.length === 0) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branchId}/inventory/items/${movs[0].inventoryItemId}/movements/${movs[0].id}`)
        .set(hdrs(ownerToken));
      expect(res.status).toBe(404);
    });

    it('movement quantity remains unchanged after failed update attempt', async () => {
      const movs = await prisma.inventoryMovement.findMany({ where: { tenantId, branchId }, take: 1 });
      if (movs.length === 0) return;

      const originalQty = movs[0].quantity;

      await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchId}/inventory/items/${movs[0].inventoryItemId}/movements/${movs[0].id}`)
        .set(hdrs(ownerToken))
        .send({ quantity: 99999 });

      const movAfter = await prisma.inventoryMovement.findUnique({ where: { id: movs[0].id } });
      expect(movAfter!.quantity).toEqual(originalQty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 13. UNIT CONVERSION USES NUMBER (NOT DECIMAL) — PRECISION AWARENESS
  // ═══════════════════════════════════════════════════════════════════

  describe('13. Quantity Handling Precision', () => {
    it('inventory movement quantities are serialized as strings (not floats)', async () => {
      const item = await createItem('Tomato-Prec', 'kg');
      await receiveBatch(item.id, 'PREC-BAT', 10.123456, 'kg', undefined, `recv-prec-${ts}`);

      const movs = await getMovements(item.id, 'RECEIVE');
      expect(movs.length).toBe(1);

      expect(typeof movs[0].quantity).toBe('string');

      const batch = await prisma.inventoryBatch.findFirst({
        where: { tenantId, branchId, inventoryItemId: item.id },
      });
      expect(typeof batch!.remainingQuantity).toBe('object');
    });
  });
});
