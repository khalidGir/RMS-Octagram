import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const ts = Date.now();

async function login(app: any, creds: { email?: string; phone?: string }): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ ...creds, password: 'Test1234!' });
  if (!res.body?.data?.accessToken)
    throw new Error(`Login failed for ${JSON.stringify(creds)}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

describe('Platform create tenant (e2e)', () => {
  let app: INestApplication;
  let superAdminToken: string;
  let ownerToken: string;

  const saEmail = `sa-create-${ts}@test.com`;
  const existingOwnerEmail = `owner-create-${ts}@test.com`;
  const existingSlug = `create-base-${ts}`;
  const newOwnerPhone = `09${String(ts % 100000000).padStart(8, '0')}`;

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  let existingTenantId: string;

  beforeAll(async () => {
    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    app.get(OutboxProcessor).stop();

    const sa = await prisma.user.create({
      data: { email: saEmail, passwordHash, displayName: 'SA Create', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    createdUserIds.push(sa.id);
    superAdminToken = await login(app, { email: saEmail });

    const baseTenant = await prisma.tenant.create({
      data: { name: 'Create Base', slug: existingSlug, status: 'ACTIVE' },
    });
    existingTenantId = baseTenant.id;
    createdTenantIds.push(baseTenant.id);

    const existingOwner = await prisma.user.create({
      data: { email: existingOwnerEmail, passwordHash, displayName: 'Create Owner', status: 'ACTIVE' },
    });
    createdUserIds.push(existingOwner.id);
    await prisma.tenantMembership.create({
      data: { tenantId: baseTenant.id, userId: existingOwner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ownerToken = await login(app, { email: existingOwnerEmail });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    for (const tenantId of createdTenantIds) {
      await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    }
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdTenantIds } } }).catch(() => {});
    for (const userId of createdUserIds) {
      await prisma.authSession.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('provisions tenant and owner for SUPER_ADMIN', async () => {
    const slug = `zebra-cafe-${ts}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: `Zebra Cafe ${ts}`,
        slug,
        ownerPhone: newOwnerPhone,
        ownerPassword: 'Test1234!',
        ownerName: 'Zebra Owner',
      });
    expect(res.status).toBe(201);
    const { tenant, owner } = res.body.data;
    createdTenantIds.push(tenant.id);
    createdUserIds.push(owner.id);
    expect(tenant.slug).toBe(slug);
    expect(tenant.status).toBe('ACTIVE');
    expect(owner.phoneE164).toBe(`+2519${String(ts % 100000000).padStart(8, '0')}`);
    expect(owner.displayName).toBe('Zebra Owner');

    const ownerLogin = await login(app, { phone: newOwnerPhone });
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerLogin}`);
    expect(me.status).toBe(200);
    const membership = me.body.data.memberships[0];
    expect(membership.tenant.slug).toBe(slug);
    expect(membership.role).toBe('OWNER');
    expect(membership.id).toBeTruthy();
  });

  it('generates a slug from the tenant name when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: `Auto Slug ${ts}`,
        ownerPhone: `09${String((ts + 1) % 100000000).padStart(8, '0')}`,
        ownerPassword: 'Test1234!',
      });
    expect(res.status).toBe(201);
    createdTenantIds.push(res.body.data.tenant.id);
    createdUserIds.push(res.body.data.owner.id);
    expect(res.body.data.tenant.slug).toBe(`auto-slug-${ts}`);
    expect(res.body.data.owner.displayName).toMatch(/^Owner \d{4}$/);
  });

  it('rejects a duplicate slug', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Dup Cafe',
        slug: existingSlug,
        ownerPhone: '0911000111',
        ownerPassword: 'Test1234!',
      });
    expect(res.status).toBe(409);
  });

  it('denies creation for a tenant OWNER without platform role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Denied Cafe',
        slug: `denied-${ts}`,
        ownerPhone: '0911000222',
        ownerPassword: 'Test1234!',
      });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid owner phone', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Bad Phone Cafe',
        slug: `bad-phone-${ts}`,
        ownerPhone: '0111234567',
        ownerPassword: 'Test1234!',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Enter a valid Ethiopian mobile number');
  });

  it('rejects a weak owner password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Weak Cafe',
        slug: `weak-${ts}`,
        ownerPhone: '0911000333',
        ownerPassword: 'lowercaseonly',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('uppercase');
  });

  it('writes an audit entry with a masked owner phone', async () => {
    const tenantId = createdTenantIds.find((id) => id !== existingTenantId);
    expect(tenantId).toBeDefined();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'PLATFORM_TENANT_CREATE', entityId: tenantId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBeTruthy();
    const after = audit!.afterJson as { ownerPhone: string };
    expect(after.ownerPhone).toMatch(/^\+2519\*{5}\d{4}$/);
    expect(after.ownerPhone).not.toContain(String(ts % 100000000));
  });
});
