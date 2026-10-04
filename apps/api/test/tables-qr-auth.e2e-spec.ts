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

describe('Table QR authorization (e2e)', () => {
  let app: any;

  let tenantAId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let publicSlug: string;
  let tableT1Id: string;
  let tableT2Id: string;
  let tableT9Id: string;

  let tenantBId: string;
  let branchBId: string;

  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let waiterToken: string;
  let crossBranchManagerToken: string;
  let otherTenantOwnerToken: string;

  const ownerEmail = `qr-auth-owner-${ts}@test.com`;
  const managerEmail = `qr-auth-manager-${ts}@test.com`;
  const cashierEmail = `qr-auth-cashier-${ts}@test.com`;
  const waiterEmail = `qr-auth-waiter-${ts}@test.com`;
  const crossBranchEmail = `qr-auth-crossbranch-${ts}@test.com`;
  const otherOwnerEmail = `qr-auth-othertenant-${ts}@test.com`;

  let rawT1Single = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenantA = await prisma.tenant.create({
      data: { name: 'QrAuthA', slug: `qr-auth-a-${ts}`, status: 'ACTIVE' },
    });
    tenantAId = tenantA.id;
    await seedEntitlements(prisma, tenantAId);
    await prisma.featureSetting.create({
      data: { tenantId: tenantAId, featureKey: 'TABLE_QR_ORDERING', enabled: true, updatedByUserId: 'system' },
    });

    publicSlug = `qr-auth-${ts}`;
    const branchA1 = await prisma.branch.create({
      data: { tenantId: tenantAId, name: 'Main Branch', slug: `qr-auth-main-${ts}`, publicSlug, isActive: true },
    });
    branchA1Id = branchA1.id;
    const branchA2 = await prisma.branch.create({
      data: { tenantId: tenantAId, name: 'Other Branch', slug: `qr-auth-other-${ts}`, publicSlug: `qr-auth-other-${ts}`, isActive: true },
    });
    branchA2Id = branchA2.id;

    async function makeUser(email: string, role: string, displayName: string, branchIds: string[]) {
      const user = await prisma.user.create({
        data: { email, passwordHash, displayName, status: 'ACTIVE' },
      });
      const membership = await prisma.tenantMembership.create({
        data: { tenantId: tenantAId, userId: user.id, role, status: 'ACTIVE' },
      });
      for (const branchId of branchIds) {
        await prisma.branchAssignment.create({ data: { tenantId: tenantAId, branchId, membershipId: membership.id } });
      }
      return user;
    }

    await makeUser(ownerEmail, 'OWNER', 'Owner', [branchA1Id, branchA2Id]);
    await makeUser(managerEmail, 'MANAGER', 'Manager', [branchA1Id]);
    await makeUser(cashierEmail, 'CASHIER', 'Cashier', [branchA1Id]);
    await makeUser(waiterEmail, 'WAITER', 'Waiter', [branchA1Id]);
    await makeUser(crossBranchEmail, 'MANAGER', 'CrossBranchManager', [branchA2Id]);

    ownerToken = await login(app, ownerEmail);
    managerToken = await login(app, managerEmail);
    cashierToken = await login(app, cashierEmail);
    waiterToken = await login(app, waiterEmail);
    crossBranchManagerToken = await login(app, crossBranchEmail);

    const tenantB = await prisma.tenant.create({
      data: { name: 'QrAuthB', slug: `qr-auth-b-${ts}`, status: 'ACTIVE' },
    });
    tenantBId = tenantB.id;
    await seedEntitlements(prisma, tenantBId);
    const branchB = await prisma.branch.create({
      data: { tenantId: tenantBId, name: 'B Branch', slug: `qr-auth-b-main-${ts}`, publicSlug: `qr-auth-b-${ts}`, isActive: true },
    });
    branchBId = branchB.id;
    const otherOwner = await prisma.user.create({
      data: { email: otherOwnerEmail, passwordHash, displayName: 'Other Owner', status: 'ACTIVE' },
    });
    const otherMembership = await prisma.tenantMembership.create({
      data: { tenantId: tenantBId, userId: otherOwner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId: tenantBId, branchId: branchBId, membershipId: otherMembership.id },
    });
    otherTenantOwnerToken = await login(app, otherOwnerEmail);

    const t1 = await prisma.restaurantTable.create({
      data: { tenantId: tenantAId, branchId: branchA1Id, label: 'T1', capacity: 4, isActive: true },
    });
    tableT1Id = t1.id;
    const t2 = await prisma.restaurantTable.create({
      data: { tenantId: tenantAId, branchId: branchA1Id, label: 'T2', capacity: 4, isActive: true },
    });
    tableT2Id = t2.id;
    const t9 = await prisma.restaurantTable.create({
      data: { tenantId: tenantAId, branchId: branchA2Id, label: 'T9', capacity: 4, isActive: true },
    });
    tableT9Id = t9.id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await prisma.tableQrToken.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.restaurantTable.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, managerEmail, cashierEmail, waiterEmail, crossBranchEmail, otherOwnerEmail] } } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  function rotateSingle(token: string, tenantId: string, branchId: string, tableId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/tables/${tableId}/qr-token/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({});
  }

  function rotateBatch(token: string, tenantId: string, branchId: string, tableIds: string[]) {
    return request(app.getHttpServer())
      .post(`/api/v1/branches/${branchId}/tables/qr-token/rotate-batch`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({ tableIds, reason: 'e2e batch' });
  }

  // ─── Single rotation ─────────────────────────────

  describe('POST .../qr-token/rotate', () => {
    it('owner can rotate and receives the raw token exactly once', async () => {
      const res = await rotateSingle(ownerToken, tenantAId, branchA1Id, tableT1Id);
      expect(res.status).toBe(201);
      expect(res.body.data.tableId).toBe(tableT1Id);
      expect(res.body.data.branchId).toBe(branchA1Id);
      expect(typeof res.body.data.raw).toBe('string');
      expect(res.body.data.raw.length).toBeGreaterThanOrEqual(32);
      expect(res.body.data.version).toBeGreaterThanOrEqual(1);
      rawT1Single = res.body.data.raw;
    });

    it('the fresh raw token resolves to the table context', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/public/table-context/resolve')
        .send({ token: rawT1Single });
      expect(res.status).toBe(201);
      expect(res.body.data.table.label).toBe('T1');
    });

    it('waiter is denied (403)', async () => {
      const res = await rotateSingle(waiterToken, tenantAId, branchA1Id, tableT1Id);
      expect(res.status).toBe(403);
    });

    it('cashier is denied (403)', async () => {
      const res = await rotateSingle(cashierToken, tenantAId, branchA1Id, tableT1Id);
      expect(res.status).toBe(403);
    });

    it('manager assigned to another branch is denied (403)', async () => {
      const res = await rotateSingle(crossBranchManagerToken, tenantAId, branchA1Id, tableT1Id);
      expect(res.status).toBe(403);
    });

    it('owner of another tenant is denied (403)', async () => {
      const res = await rotateSingle(otherTenantOwnerToken, tenantAId, branchA1Id, tableT1Id);
      expect(res.status).toBe(403);
    });

    it('unauthenticated request is denied (401)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchA1Id}/tables/${tableT1Id}/qr-token/rotate`)
        .set('x-tenant-id', tenantAId)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ─── Batch rotation ──────────────────────────────

  describe('POST .../qr-token/rotate-batch', () => {
    it('owner rotates the selected tables and results follow input order', async () => {
      const res = await rotateBatch(ownerToken, tenantAId, branchA1Id, [tableT2Id, tableT1Id]);
      expect(res.status).toBe(201);
      const data = res.body.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data.map((r: { tableId: string }) => r.tableId)).toEqual([tableT2Id, tableT1Id]);
      expect(data.map((r: { label: string }) => r.label)).toEqual(['T2', 'T1']);
      for (const row of data) {
        expect(typeof row.raw).toBe('string');
        expect(row.raw.length).toBeGreaterThanOrEqual(32);
        expect(row.version).toBeGreaterThanOrEqual(1);
      }
      expect(data[0].raw).not.toBe(data[1].raw);
      // T1 was rotated once before, so the batch rotation bumps its version.
      const t1Row = data.find((r: { tableId: string }) => r.tableId === tableT1Id);
      expect(t1Row.version).toBe(2);
    });

    it('batch rotation revokes the previous raw token immediately', async () => {
      const old = await request(app.getHttpServer())
        .post('/api/v1/public/table-context/resolve')
        .send({ token: rawT1Single });
      expect(old.status).toBe(404);

      const activeRes = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/tables/${tableT1Id}/qr-token`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantAId);
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data.version).toBe(2);
      expect(activeRes.body.data).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(activeRes.body)).not.toContain(rawT1Single);
    });

    it('raw tokens are never persisted in plaintext', async () => {
      const tokens = await prisma.tableQrToken.findMany({
        where: { tenantId: tenantAId },
        select: { tokenHash: true },
      });
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      for (const t of tokens) {
        expect(t.tokenHash).not.toBe(rawT1Single);
        expect(t.tokenHash.length).toBe(64);
      }
    });

    it('token history exposes versions without hashes and marks revoked ones', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/tables/${tableT1Id}/qr-token/history`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.length).toBeGreaterThanOrEqual(2);
      expect(data[0].version).toBe(2);
      expect(data[0].revokedAt).toBeNull();
      expect(data[1].version).toBe(1);
      expect(data[1].revokedAt).not.toBeNull();
      expect(JSON.stringify(data)).not.toContain('tokenHash');
      expect(JSON.stringify(data)).not.toContain(rawT1Single);
    });

    it('manager can rotate a batch', async () => {
      const res = await rotateBatch(managerToken, tenantAId, branchA1Id, [tableT2Id]);
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
    });

    it('waiter is denied (403)', async () => {
      const res = await rotateBatch(waiterToken, tenantAId, branchA1Id, [tableT1Id]);
      expect(res.status).toBe(403);
    });

    it('cashier is denied (403)', async () => {
      const res = await rotateBatch(cashierToken, tenantAId, branchA1Id, [tableT1Id]);
      expect(res.status).toBe(403);
    });

    it('manager assigned to another branch is denied (403) and no token is issued', async () => {
      const res = await rotateBatch(crossBranchManagerToken, tenantAId, branchA1Id, [tableT1Id]);
      expect(res.status).toBe(403);
      const count = await prisma.tableQrToken.count({ where: { tableId: tableT1Id, revokedAt: null } });
      expect(count).toBe(1);
    });

    it('owner of another tenant is denied (403)', async () => {
      const res = await rotateBatch(otherTenantOwnerToken, tenantAId, branchA1Id, [tableT1Id]);
      expect(res.status).toBe(403);
    });

    it('cross-tenant rotation of a branch-foreign table never resolves', async () => {
      // Tenant B owner cannot rotate a tenant A table even with tenant A context.
      const res = await rotateBatch(otherTenantOwnerToken, tenantAId, branchA1Id, [tableT9Id]);
      expect(res.status).toBe(403);
      const tokens = await prisma.tableQrToken.findMany({ where: { tableId: tableT9Id } });
      expect(tokens).toHaveLength(0);
    });

    it('unauthenticated request is denied (401)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branchA1Id}/tables/qr-token/rotate-batch`)
        .set('x-tenant-id', tenantAId)
        .send({ tableIds: [tableT1Id] });
      expect(res.status).toBe(401);
    });

    it('rejects an empty selection (400)', async () => {
      const res = await rotateBatch(ownerToken, tenantAId, branchA1Id, []);
      expect(res.status).toBe(400);
    });

    it('rejects a batch larger than the documented cap (400)', async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      const res = await rotateBatch(ownerToken, tenantAId, branchA1Id, tooMany);
      expect(res.status).toBe(400);
    });

    it('rejects tables outside the branch (400/404)', async () => {
      const res = await rotateBatch(ownerToken, tenantAId, branchA1Id, [tableT9Id]);
      expect([400, 404]).toContain(res.status);
      const tokens = await prisma.tableQrToken.findMany({ where: { tableId: tableT9Id } });
      expect(tokens).toHaveLength(0);
    });
  });

  // ─── QR branding ─────────────────────────────────

  describe('GET .../qr-branding', () => {
    it('owner reads restaurant/branch identity and short-link slug', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/qr-branding`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(200);
      expect(res.body.data.restaurantName).toBe('QrAuthA');
      expect(res.body.data.branchName).toBe('Main Branch');
      expect(res.body.data.publicSlug).toBe(publicSlug);
    });

    it('waiter assigned to the branch can read branding', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/qr-branding`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(200);
    });

    it('manager without assignment to the target branch is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/qr-branding`)
        .set('Authorization', `Bearer ${crossBranchManagerToken}`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(403);
    });

    it('owner of another tenant is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/qr-branding`)
        .set('Authorization', `Bearer ${otherTenantOwnerToken}`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(403);
    });

    it('unauthenticated request is denied (401)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA1Id}/qr-branding`)
        .set('x-tenant-id', tenantAId);
      expect(res.status).toBe(401);
    });
  });
});
