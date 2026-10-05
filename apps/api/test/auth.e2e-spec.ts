import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

// ─── TEST DATABASE SAFETY ─────────────────────────────────────────
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required.');
}
if (!TEST_DATABASE_URL.includes('test')) {
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

// Override DATABASE_URL so the NestJS PrismaService connects to the test DB
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

describe('Auth & Tenancy Security (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let mainBranchId: string;
  let downtownBranchId: string;
  let managerMembershipId: string;
  let cashierMembershipId: string;

  // Second tenant
  let owner2Token: string;
  let tenant2Id: string;
  let owner2UserId: string;

  const ts = Date.now();
  const ownerEmail = `se-owner-${ts}@test.com`;
  const managerEmail = `se-manager-${ts}@test.com`;
  const cashierEmail = `se-cashier-${ts}@test.com`;
  const owner2Email = `se-owner2-${ts}@test.com`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    app.get(OutboxProcessor).stop();

    // Seed via DB directly — no /register endpoint
    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // Tenant 1
    const t1 = await prisma.tenant.create({ data: { name: 'SecTest T1', slug: `sec-t1-${ts}`, status: 'ACTIVE' } });
    tenantId = t1.id;
    await seedEntitlements(prisma, tenantId);
    const o1 = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner1', status: 'ACTIVE' } });
    await prisma.tenantMembership.create({ data: { tenantId, userId: o1.id, role: 'OWNER', status: 'ACTIVE' } });
    const b1 = await prisma.branch.create({ data: { tenantId, name: 'Main', slug: 'main', isActive: true } });
    mainBranchId = b1.id;
    const b2 = await prisma.branch.create({ data: { tenantId, name: 'Downtown', slug: 'downtown', isActive: true } });
    downtownBranchId = b2.id;

    // Manager
    const m1 = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Mgr1', status: 'ACTIVE' } });
    const m1m = await prisma.tenantMembership.create({ data: { tenantId, userId: m1.id, role: 'MANAGER', status: 'ACTIVE' } });
    managerMembershipId = m1m.id;
    await prisma.branchAssignment.createMany({ data: [
      { tenantId, branchId: mainBranchId, membershipId: m1m.id },
      { tenantId, branchId: downtownBranchId, membershipId: m1m.id },
    ] });

    // Cashier
    const c1 = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cash1', status: 'ACTIVE' } });
    const c1m = await prisma.tenantMembership.create({ data: { tenantId, userId: c1.id, role: 'CASHIER', status: 'ACTIVE' } });
    cashierMembershipId = c1m.id;
    await prisma.branchAssignment.create({ data: { tenantId, branchId: mainBranchId, membershipId: c1m.id } });

    // Tenant 2
    const t2 = await prisma.tenant.create({ data: { name: 'SecTest T2', slug: `sec-t2-${ts}`, status: 'ACTIVE' } });
    tenant2Id = t2.id;
    await seedEntitlements(prisma, tenant2Id);
    const o2 = await prisma.user.create({ data: { email: owner2Email, passwordHash, displayName: 'Owner2', status: 'ACTIVE' } });
    owner2UserId = o2.id;
    await prisma.tenantMembership.create({ data: { tenantId: tenant2Id, userId: o2.id, role: 'OWNER', status: 'ACTIVE' } });

    // Login all
    const login = async (email: string) => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
      return res.body.data.accessToken as string;
    };
    ownerToken = await login(ownerEmail);
    managerToken = await login(managerEmail);
    cashierToken = await login(cashierEmail);
    owner2Token = await login(owner2Email);
  }, 30000);

  afterAll(async () => {
    await app?.close();
    // Cleanup in reverse order — filter undefined tenant IDs (beforeAll may have failed early)
    const tenantIds = [tenantId, tenant2Id].filter((id): id is string => !!id);
    if (tenantIds.length > 0) {
      await prisma.branchAssignment.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.branch.deleteMany({ where: { tenantId: { in: tenantIds } } });
      for (const tid of tenantIds) await cleanupEntitlements(prisma, tid);
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.authSession.deleteMany({ where: { user: { email: { contains: 'se-' } } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'se-' } } });
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════
  // Login & Rate Limiting
  // ═══════════════════════════════════════════════
  describe('Login & Rate Limiting', () => {
    it('returns tokens on valid login', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects invalid credentials', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('rejects nonexistent user', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@test.com', password: 'x' });
      expect(res.status).toBe(401);
    });

    it('rejects empty body', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('rate limits after 10 failures', async () => {
      const rateEmail = `rate-${ts}@test.com`;
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: rateEmail, password: 'bad' });
      }
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: rateEmail, password: 'bad' });
      expect(res.status).toBe(429);
    });
  });

  // ═══════════════════════════════════════════════
  // Refresh Token Security
  // ═══════════════════════════════════════════════
  describe('Refresh Token Security', () => {
    it('rotates tokens on refresh', async () => {
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Test1234!' });
      const cookie = loginRes.headers['set-cookie']?.find((c: string) => c.startsWith('refresh_token='));
      const refreshRes = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeDefined();
    });

    it('detects reuse and revokes family', async () => {
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Test1234!' });
      const cookie = loginRes.headers['set-cookie']?.find((c: string) => c.startsWith('refresh_token='));
      const raw = cookie?.split('=')[1]?.split(';')[0];

      // Use it
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie);

      // Reuse — should be 401
      const reuse = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`);
      expect(reuse.status).toBe(401);
    });

    it('invalid secret cannot revoke family', async () => {
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Test1234!' });
      const cookie = loginRes.headers['set-cookie']?.find((c: string) => c.startsWith('refresh_token='));
      const selector = cookie?.split('=')[1]?.split(';')[0]?.split(':')[0];

      // Use valid token first
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie);

      // Try with valid selector but wrong secret
      const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${selector}:badsecret`);
      expect(res.status).toBe(401);
    });

    it('rejects missing refresh token', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh');
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════
  // Logout
  // ═══════════════════════════════════════════════
  describe('Logout', () => {
    it('revokes session on logout', async () => {
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Test1234!' });
      const cookie = loginRes.headers['set-cookie']?.find((c: string) => c.startsWith('refresh_token='));
      await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie);
      const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(refresh.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════
  // Cross-Tenant Isolation
  // ═══════════════════════════════════════════════
  describe('Cross-Tenant Isolation', () => {
    it('owner cannot access another tenant branches', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenant2Id);
      expect(res.status).toBe(403);
    });

    it('owner cannot list another tenant memberships', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/memberships').set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenant2Id);
      expect(res.status).toBe(403);
    });

    it('manager cannot modify another tenant membership', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/fake-id`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenant2Id)
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(403);
    });

    it('suspended tenant is rejected', async () => {
      const suspended = await prisma.tenant.create({ data: { name: 'Suspended', slug: `susp-${ts}`, status: 'SUSPENDED' } });
      const user = await prisma.user.create({ data: { email: `susp-user-${ts}@test.com`, passwordHash: await argon2.hash('Test1234!'), displayName: 'S', status: 'ACTIVE' } });
      const mem = await prisma.tenantMembership.create({ data: { tenantId: suspended.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: `susp-user-${ts}@test.com`, password: 'Test1234!' });
      const token = loginRes.body.data.accessToken;
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${token}`).set('x-tenant-id', suspended.id);
      expect(res.status).toBe(403);

      await prisma.tenantMembership.deleteMany({ where: { tenantId: suspended.id } });
      await prisma.tenant.delete({ where: { id: suspended.id } });
      await prisma.authSession.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('suspended membership is rejected', async () => {
      const suspMem = await prisma.tenantMembership.update({
        where: { id: cashierMembershipId },
        data: { status: 'SUSPENDED' },
      });
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(403);

      await prisma.tenantMembership.update({ where: { id: cashierMembershipId }, data: { status: 'ACTIVE' } });
    });
  });

  // ═══════════════════════════════════════════════
  // Branch Scope Enforcement
  // ═══════════════════════════════════════════════
  describe('Branch Scope Enforcement', () => {
    it('cashier sees only assigned branches', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${cashierToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(mainBranchId);
    });

    it('owner sees all branches', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('inactive branch excluded from scope', async () => {
      await prisma.branch.update({ where: { id: downtownBranchId }, data: { isActive: false } });
      const res = await request(app.getHttpServer()).get('/api/v1/branches').set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId);
      const ids = res.body.data.map((b: any) => b.id);
      expect(ids).not.toContain(downtownBranchId);
      await prisma.branch.update({ where: { id: downtownBranchId }, data: { isActive: true } });
    });
  });

  // ═══════════════════════════════════════════════
  // Manager Role Boundaries
  // ═══════════════════════════════════════════════
  describe('Manager Role Boundaries', () => {
    it('manager cannot promote to Owner', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${cashierMembershipId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ role: 'OWNER' });
      expect(res.status).toBe(403);
    });

    it('manager cannot suspend Owner', async () => {
      const ownerMem = await prisma.tenantMembership.findFirst({ where: { tenantId, role: 'OWNER' } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${ownerMem!.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(403);
    });

    it('manager cannot revoke Manager', async () => {
      const selfMem = await prisma.tenantMembership.findFirst({ where: { tenantId, userId: (await prisma.user.findFirst({ where: { email: managerEmail } }))!.id } });
      // Manager cannot modify another manager — but this test uses the manager's own token
      // to try to modify themselves, which should also fail
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${selfMem!.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ status: 'REVOKED' });
      // Should fail: cannot modify own membership
      expect(res.status).toBe(403);
    });

    it('manager cannot modify another manager branch assignments', async () => {
      // Create a second manager
      const m2 = await prisma.user.create({ data: { email: `mgr2-${ts}@test.com`, passwordHash: await argon2.hash('Test1234!'), displayName: 'Mgr2', status: 'ACTIVE' } });
      const m2m = await prisma.tenantMembership.create({ data: { tenantId, userId: m2.id, role: 'MANAGER', status: 'ACTIVE' } });
      await prisma.branchAssignment.create({ data: { tenantId, branchId: mainBranchId, membershipId: m2m.id } });

      const res = await request(app.getHttpServer())
        .put(`/api/v1/memberships/${m2m.id}/branches`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ branchIds: [] });
      expect(res.status).toBe(403);

      await prisma.branchAssignment.deleteMany({ where: { membershipId: m2m.id } });
      await prisma.tenantMembership.delete({ where: { id: m2m.id } });
      await prisma.user.delete({ where: { id: m2.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // Deactivated User
  // ═══════════════════════════════════════════════
  describe('Deactivated User', () => {
    it('deactivated user JWT is rejected', async () => {
      // Create a temp user, login, then deactivate
      const pw = await argon2.hash('Test1234!');
      const temp = await prisma.user.create({ data: { email: `temp-${ts}@test.com`, passwordHash: pw, displayName: 'Temp', status: 'ACTIVE' } });
      const t1 = await prisma.tenantMembership.create({ data: { tenantId, userId: temp.id, role: 'CASHIER', status: 'ACTIVE' } });
      await prisma.branchAssignment.create({ data: { tenantId, branchId: mainBranchId, membershipId: t1.id } });

      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: `temp-${ts}@test.com`, password: 'Test1234!' });
      const token = loginRes.body.data.accessToken;

      // Deactivate
      await prisma.authSession.updateMany({ where: { userId: temp.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await prisma.user.update({ where: { id: temp.id }, data: { status: 'DELETED' } });

      // Token should be rejected by JWT strategy (checks user status)
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);

      // Cleanup
      await prisma.branchAssignment.deleteMany({ where: { membershipId: t1.id } });
      await prisma.tenantMembership.delete({ where: { id: t1.id } });
      await prisma.authSession.deleteMany({ where: { userId: temp.id } });
      await prisma.user.delete({ where: { id: temp.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // Audit Trail
  // ═══════════════════════════════════════════════
  describe('Audit Trail', () => {
    it('creates audit entry for membership mutation', async () => {
      const before = await prisma.auditLog.count({ where: { tenantId, entityType: 'TenantMembership' } });

      await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${cashierMembershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ status: 'ACTIVE' });

      const after = await prisma.auditLog.count({ where: { tenantId, entityType: 'TenantMembership' } });
      expect(after).toBeGreaterThan(before);
    });
  });

  // ═══════════════════════════════════════════════
  // Invitation Flow
  // ═══════════════════════════════════════════════
  describe('Invitation Flow', () => {
    const inviteSuffix = ((ts + 1) % 100000000).toString().padStart(8, '0');
    const invitePhone = `+2519${inviteSuffix}`;

    it('creates invitation with hashed token via phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/memberships/invitations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ phone: invitePhone, role: 'CASHIER', branchIds: [mainBranchId] });

      expect(res.status).toBe(201);
      expect(res.body.data.invitationToken).toBeDefined();
      expect(res.body.data.membershipId).toBeDefined();

      // Verify token is not stored in plaintext
      const mem = await prisma.tenantMembership.findUnique({ where: { id: res.body.data.membershipId } });
      expect(mem?.invitationTokenHash).toBeDefined();
      expect(mem?.invitationTokenHash).not.toBe(res.body.data.invitationToken);
      expect(mem?.status).toBe('INVITED');

      // Invited user is created with phone identity
      const invitedUser = await prisma.user.findUnique({ where: { phoneE164: invitePhone } });
      expect(invitedUser).not.toBeNull();
      expect(invitedUser!.displayName).toBe(`Staff ${inviteSuffix.slice(-4)}`);

      // Audit stores the masked phone, never the full number
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'MEMBERSHIP_INVITE', entityId: mem!.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      const after = audit!.afterJson as Record<string, unknown>;
      expect(after.phone).toBe(`+2519*****${inviteSuffix.slice(-4)}`);
      expect(JSON.stringify(after)).not.toContain(invitePhone);

      // Duplicate invite for the same phone → 409
      const dup = await request(app.getHttpServer())
        .post('/api/v1/memberships/invitations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ phone: invitePhone, role: 'CASHIER', branchIds: [mainBranchId] });
      expect(dup.status).toBe(409);

      // Local format resolves to the same invite target → still 409
      const dupLocal = await request(app.getHttpServer())
        .post('/api/v1/memberships/invitations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ phone: `09${inviteSuffix}`, role: 'CASHIER', branchIds: [mainBranchId] });
      expect(dupLocal.status).toBe(409);

      // Cleanup (invited user has no email — must delete by phone)
      await prisma.branchAssignment.deleteMany({ where: { membershipId: mem!.id } });
      await prisma.tenantMembership.delete({ where: { id: mem!.id } });
      await prisma.authSession.deleteMany({ where: { userId: invitedUser!.id } });
      await prisma.user.delete({ where: { id: invitedUser!.id } });
    });

    it('rejects invitation with invalid phone number', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/memberships/invitations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ phone: '0111234567', role: 'CASHIER', branchIds: [mainBranchId] });
      expect(res.status).toBe(400);
    });

    it('invitation expires', async () => {
      // Create membership with expired invitation — hash must match the token sent
      const crypto = await import('crypto');
      const expToken = `exp-token-${ts}`;
      const expTokenHash = crypto.createHash('sha256').update(expToken).digest('hex');
      const pw = await argon2.hash('Test1234!');
      const u = await prisma.user.create({ data: { email: `exp-${ts}@test.com`, passwordHash: pw, displayName: 'Exp', status: 'ACTIVE' } });
      const m = await prisma.tenantMembership.create({
        data: {
          tenantId, userId: u.id, role: 'CASHIER', status: 'INVITED',
          invitationTokenHash: expTokenHash,
          invitationExpiresAt: new Date(Date.now() - 1000),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/memberships/accept-invitation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ invitationToken: expToken });

      expect(res.status).toBe(400);

      await prisma.tenantMembership.delete({ where: { id: m.id } });
      await prisma.authSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    });

    it('invitation is single-use', async () => {
      // Create a membership with a known token hash
      const pw = await argon2.hash('Test1234!');
      const u = await prisma.user.create({ data: { email: `single-${ts}@test.com`, passwordHash: pw, displayName: 'Single', status: 'ACTIVE' } });
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const m = await prisma.tenantMembership.create({
        data: {
          tenantId, userId: u.id, role: 'CASHIER', status: 'INVITED',
          invitationTokenHash: tokenHash,
          invitationExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Accept
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: `single-${ts}@test.com`, password: 'Test1234!' });
      const uToken = loginRes.body.data.accessToken;

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/memberships/accept-invitation')
        .set('Authorization', `Bearer ${uToken}`)
        .send({ invitationToken: token });
      expect(res1.status).toBe(200);

      // Try again — should fail (single-use)
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/memberships/accept-invitation')
        .set('Authorization', `Bearer ${uToken}`)
        .send({ invitationToken: token });
      expect(res2.status).toBe(404);

      await prisma.branchAssignment.deleteMany({ where: { membershipId: m.id } });
      await prisma.tenantMembership.delete({ where: { id: m.id } });
      await prisma.authSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    });
  });

  // ═══════════════════════════════════════════════
  // Phone-first authentication
  // ═══════════════════════════════════════════════
  describe('Phone-first authentication', () => {
    const suffix = (n: number) => ((ts + n) % 100000000).toString().padStart(8, '0');
    const phOwner = `+2519${suffix(3)}`;
    const phOwnerLocal = `09${suffix(3)}`;
    const phOwnerNational = `9${suffix(3)}`;
    const phOwnerE164 = phOwner;
    const phOwnerHyphen = `09${suffix(3).slice(0, 3)}-${suffix(3).slice(3, 6)}-${suffix(3).slice(6)}`;
    const phRate = `+2519${suffix(2)}`;
    const phRateLocal = `09${suffix(2)}`;
    const phUnknown = `+2519${suffix(50)}`;

    const loginWith = (phone: string, password = 'Test1234!') =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ phone, password });

    const decodeJwt = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

    beforeAll(async () => {
      const hash = await argon2.hash('Test1234!', { type: argon2.argon2id });
      await prisma.user.create({
        data: { email: `se-ph-${ts}@test.com`, phoneE164: phOwner, passwordHash: hash, displayName: 'PhOwner', status: 'ACTIVE' },
      });
      await prisma.user.create({
        data: { email: `se-phrate-${ts}@test.com`, phoneE164: phRate, passwordHash: hash, displayName: 'PhRate', status: 'ACTIVE' },
      });
    });

    it('accepts local, national, E.164, spaced and hyphenated formats', async () => {
      const spaced = `${phOwnerLocal.slice(0, 4)} ${phOwnerLocal.slice(4, 7)} ${phOwnerLocal.slice(7)}`;
      for (const phone of [phOwnerLocal, phOwnerNational, phOwnerE164, spaced, phOwnerHyphen]) {
        const res = await loginWith(phone);
        expect(res.status, `format: ${phone}`).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
      }
    });

    it('local and E.164 formats resolve to the same user', async () => {
      const a = await loginWith(phOwnerLocal);
      const b = await loginWith(phOwnerE164);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const meA = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${a.body.data.accessToken}`);
      const meB = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${b.body.data.accessToken}`);

      expect(meA.body.data.id).toBe(meB.body.data.id);
      expect(meA.body.data.phone).toBe(phOwner);
    });

    it('/auth/me returns the phone in E.164', async () => {
      const login = await loginWith(phOwnerLocal);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.data.phone).toBe(phOwnerE164);
    });

    it('JWT access token carries the phone claim', async () => {
      const login = await loginWith(phOwnerE164);
      const payload = decodeJwt(login.body.data.accessToken);
      expect(payload.phone).toBe(phOwnerE164);
      expect(payload.sub).toBeDefined();
    });

    it('rejects wrong password with generic 401', async () => {
      const res = await loginWith(phOwnerLocal, 'wrong-password');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects unknown phone with generic 401', async () => {
      const res = await loginWith(phUnknown);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects malformed and landline numbers with generic 401', async () => {
      for (const phone of ['0111234567', '+14155552671', 'not-a-phone', '091123456']) {
        const res = await loginWith(phone);
        expect(res.status, `input: ${phone}`).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
      }
    });

    it('rate limit cannot be bypassed by reformatting the phone', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await loginWith(phRateLocal, 'wrong-password');
        expect(res.status).toBe(401);
      }
      // Same identity expressed in E.164 must be locked out too
      const reformatted = await loginWith(phRate, 'wrong-password');
      expect(reformatted.status).toBe(429);
      // Even the correct password is rejected while locked
      const correct = await loginWith(phRate, 'Test1234!');
      expect(correct.status).toBe(429);
    });

    it('creates tenant with owner phone as identity', async () => {
      const tenancy = moduleRef.get(TenancyService);
      const ownerSuffix = suffix(4);
      const result = await tenancy.createTenant({
        name: `PhoneT ${ts}`,
        slug: `phone-t-${ts}`,
        ownerPhone: `09${ownerSuffix}`,
        ownerPassword: 'Test1234!',
        ownerName: 'PhoneOwner',
      });
      expect(result.owner.phoneE164).toBe(`+2519${ownerSuffix}`);

      try {
        const login = await loginWith(`09${ownerSuffix}`);
        expect(login.status).toBe(200);
        const me = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${login.body.data.accessToken}`);
        expect(me.body.data.phone).toBe(`+2519${ownerSuffix}`);
        expect(me.body.data.memberships[0].tenant.slug).toBe(`phone-t-${ts}`);
      } finally {
        await prisma.featureSetting.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenantEntitlement.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenantMembership.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenant.deleteMany({ where: { id: result.tenant.id } });
        await prisma.authSession.deleteMany({ where: { userId: result.owner.id } });
        await prisma.user.deleteMany({ where: { id: result.owner.id } });
      }
    });

    it('rejects tenant creation with invalid owner phone', async () => {
      const tenancy = moduleRef.get(TenancyService);
      await expect(
        tenancy.createTenant({
          name: `PhoneBad ${ts}`,
          slug: `phone-bad-${ts}`,
          ownerPhone: '0111234567',
          ownerPassword: 'Test1234!',
          ownerName: 'BadOwner',
        }),
      ).rejects.toThrow('Enter a valid Ethiopian mobile number');
    });
  });
});
