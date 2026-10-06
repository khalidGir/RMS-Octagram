import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { BrandingStorageService } from '../src/modules/tenancy/branding-storage.service';
import { SqsQueueService } from '../src/modules/outbox/sqs-queue.service';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.MEDIA_CDN_URL = process.env.MEDIA_CDN_URL || 'https://media.example.test';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

// In-memory stand-in for S3, mirroring BrandingStorageService's contract
// (type/size gate and deterministic verification without AWS credentials).
const inMemoryBrandingStorage = {
  bucket: 'test-media-bucket',
  objects: new Map<string, { sizeBytes: number; contentType: string; sha256: string }>(),
  async createUpload(params: {
    tenantId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }) {
    const accepted = ['image/jpeg', 'image/png', 'image/webp'];
    if (
      !accepted.includes(params.contentType) ||
      params.sizeBytes < 1 ||
      params.sizeBytes > 10 * 1024 * 1024
    ) {
      throw new BadRequestException('Unsupported logo image');
    }
    const extension =
      params.contentType === 'image/jpeg' ? 'jpg' : params.contentType.split('/')[1];
    const objectKey = `tenant/${params.tenantId}/logo/original/${randomUUID()}.${extension}`;
    return {
      uploadUrl: `https://s3.test.local/${objectKey}`,
      objectKey,
      fields: { key: objectKey },
    };
  },
  async verifyObject(params: {
    objectKey: string;
    sizeBytes: number;
    contentType: string;
    sha256: string;
  }) {
    const stored = this.objects.get(params.objectKey);
    if (!stored) throw new BadRequestException('Uploaded logo was not found');
    if (
      stored.sizeBytes !== params.sizeBytes ||
      stored.contentType !== params.contentType ||
      stored.sha256 !== params.sha256
    ) {
      throw new BadRequestException('Uploaded logo does not match its upload intent');
    }
  },
  simulateUpload(objectKey: string, sizeBytes: number, contentType: string, sha256: string) {
    this.objects.set(objectKey, { sizeBytes, contentType, sha256 });
  },
};

const sqsCapture = { send: vi.fn(async () => undefined) };

describe('Tenant Branding Logo (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let branchBOwnerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let waiterToken: string;
  let outsiderToken: string;
  let tenantId: string;
  let otherTenantId: string;
  let ownerUserId: string;

  const ts = Date.now();
  const ownerEmail = `br-owner-${ts}@test.com`;
  const branchBOwnerEmail = `br-ob-${ts}@test.com`;
  const managerEmail = `br-manager-${ts}@test.com`;
  const cashierEmail = `br-cashier-${ts}@test.com`;
  const waiterEmail = `br-waiter-${ts}@test.com`;
  const outsiderEmail = `br-outsider-${ts}@test.com`;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: 'Test1234!' });
    if (!res.body?.data?.accessToken)
      throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.accessToken;
  };

  const uploadIntent = (
    token: string,
    expectedVersion: number,
    overrides: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/tenants/current/logo/upload-intent')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({
        contentType: 'image/png',
        sizeBytes: 256,
        sha256: 'a'.repeat(64),
        crop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion,
        ...overrides,
      });

  const finalizeLogo = (token: string, mediaObjectId: string, expectedVersion: number) =>
    request(app.getHttpServer())
      .post('/api/v1/tenants/current/logo/finalize')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({ mediaObjectId, expectedVersion });

  const logoStatus = (token: string, mediaObjectId?: string) => {
    const query = mediaObjectId ? `?mediaObjectId=${encodeURIComponent(mediaObjectId)}` : '';
    return request(app.getHttpServer())
      .get(`/api/v1/tenants/current/logo/status${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId);
  };

  const removeLogo = (token: string, expectedVersion: number) =>
    request(app.getHttpServer())
      .delete('/api/v1/tenants/current/logo')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({ expectedVersion });

  // The tenant-wide cap of two concurrent active intents is a product rule;
  // earlier suites' throwaway intents must expire before a new describe needs
  // fresh quota (expiry is the same lever the service itself uses).
  const expirePendingIntents = async () => {
    await prisma.mediaObject.updateMany({
      where: {
        tenantId,
        purpose: 'TENANT_LOGO',
        processingStatus: { in: ['PENDING_UPLOAD', 'PENDING_PROCESSING', 'PROCESSING'] },
      },
      data: { uploadExpiresAt: new Date(Date.now() - 60_000) },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BrandingStorageService)
      .useValue(inMemoryBrandingStorage)
      .overrideProvider(SqsQueueService)
      .useValue(sqsCapture)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    app.get(OutboxProcessor).stop();
    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({
      data: { name: 'BrandingTest', slug: `branding-test-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branchB = await prisma.branch.create({
      data: { tenantId, name: 'BrandingB', slug: `brb-${ts}`, isActive: true },
    });

    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    ownerUserId = owner.id;
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branchB.id, membershipId: om.id },
    });

    // Owner assigned ONLY to branch B: branding is tenant-level, so branch
    // scope must not gate these routes (deliberate tenant-wide allowance).
    const branchBOwner = await prisma.user.create({
      data: {
        email: branchBOwnerEmail,
        passwordHash,
        displayName: 'Branch Owner',
        status: 'ACTIVE',
      },
    });
    const obm = await prisma.tenantMembership.create({
      data: { tenantId, userId: branchBOwner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branchB.id, membershipId: obm.id },
    });

    const manager = await prisma.user.create({
      data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' },
    });
    const mm = await prisma.tenantMembership.create({
      data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branchB.id, membershipId: mm.id },
    });

    const cashier = await prisma.user.create({
      data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' },
    });
    const cm = await prisma.tenantMembership.create({
      data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branchB.id, membershipId: cm.id },
    });

    const waiter = await prisma.user.create({
      data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' },
    });
    const wm = await prisma.tenantMembership.create({
      data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branchB.id, membershipId: wm.id },
    });

    const otherTenant = await prisma.tenant.create({
      data: { name: 'BrandingOther', slug: `br-other-${ts}`, status: 'ACTIVE' },
    });
    otherTenantId = otherTenant.id;
    await seedEntitlements(prisma, otherTenantId);
    const outsider = await prisma.user.create({
      data: { email: outsiderEmail, passwordHash, displayName: 'Outsider', status: 'ACTIVE' },
    });
    const outm = await prisma.tenantMembership.create({
      data: { tenantId: otherTenantId, userId: outsider.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const otherBranch = await prisma.branch.create({
      data: { tenantId: otherTenantId, name: 'OB', slug: `bro-${ts}`, isActive: true },
    });
    await prisma.branchAssignment.create({
      data: { tenantId: otherTenantId, branchId: otherBranch.id, membershipId: outm.id },
    });

    ownerToken = await login(ownerEmail);
    branchBOwnerToken = await login(branchBOwnerEmail);
    managerToken = await login(managerEmail);
    cashierToken = await login(cashierEmail);
    waiterToken = await login(waiterEmail);
    outsiderToken = await login(outsiderEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, tenantId);
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment
      .deleteMany({ where: { tenantId: otherTenantId } })
      .catch(() => {});
    await prisma.tenantMembership
      .deleteMany({ where: { tenantId: otherTenantId } })
      .catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, otherTenantId);
    await prisma.user
      .deleteMany({
        where: {
          email: {
            in: [
              ownerEmail,
              branchBOwnerEmail,
              managerEmail,
              cashierEmail,
              waiterEmail,
              outsiderEmail,
            ],
          },
        },
      })
      .catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('Role matrix (owner only)', () => {
    it('owner can create an upload intent', async () => {
      const res = await uploadIntent(ownerToken, 1);
      expect(res.status).toBe(201);
      expect(res.body.data.mediaObjectId).toBeDefined();
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.tenantVersion).toBe(1);

      const media = await prisma.mediaObject.findUnique({
        where: { id: res.body.data.mediaObjectId },
      });
      expect(media).toMatchObject({
        tenantId,
        branchId: null,
        targetMenuItemId: null,
        purpose: 'TENANT_LOGO',
        processingStatus: 'PENDING_UPLOAD',
        bucket: inMemoryBrandingStorage.bucket,
        uploadedByUserId: ownerUserId,
      });
      expect(media!.objectKey).toContain('/logo/original/');
      expect(media!.objectKey).not.toContain('menu-items');
      expect(media!.objectKey).not.toContain('branch');
    });

    it('manager is denied on all branding endpoints', async () => {
      expect((await uploadIntent(managerToken, 1)).status).toBe(403);
      expect((await finalizeLogo(managerToken, randomUUID(), 1)).status).toBe(403);
      expect((await logoStatus(managerToken)).status).toBe(403);
      expect((await removeLogo(managerToken, 1)).status).toBe(403);
    });

    it('cashier is denied on all branding endpoints', async () => {
      expect((await uploadIntent(cashierToken, 1)).status).toBe(403);
      expect((await finalizeLogo(cashierToken, randomUUID(), 1)).status).toBe(403);
      expect((await logoStatus(cashierToken)).status).toBe(403);
      expect((await removeLogo(cashierToken, 1)).status).toBe(403);
    });

    it('waiter is denied on all branding endpoints', async () => {
      expect((await uploadIntent(waiterToken, 1)).status).toBe(403);
      expect((await finalizeLogo(waiterToken, randomUUID(), 1)).status).toBe(403);
      expect((await logoStatus(waiterToken)).status).toBe(403);
      expect((await removeLogo(waiterToken, 1)).status).toBe(403);
    });

    it('unauthenticated requests are rejected with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/tenants/current/logo/upload-intent')
        .set('Content-Type', 'application/json')
        .send({
          contentType: 'image/png',
          sizeBytes: 128,
          sha256: 'a'.repeat(64),
          crop: { x: 0, y: 0, width: 1, height: 1 },
          expectedVersion: 1,
        });
      expect(res.status).toBe(401);
    });

    it('a branch-B-only owner is allowed because branding is tenant-level', async () => {
      const res = await uploadIntent(branchBOwnerToken, 1);
      expect(res.status).toBe(201);
    });
  });

  describe('Tenant isolation', () => {
    it('rejects another tenant owner using our tenant header', async () => {
      const res = await uploadIntent(outsiderToken, 1);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('member');
    });

    it('rejects finalize of another tenant media id with 404', async () => {
      const foreign = await prisma.mediaObject.create({
        data: {
          tenantId: otherTenantId,
          branchId: null,
          paymentId: null,
          targetMenuItemId: null,
          purpose: 'TENANT_LOGO',
          bucket: inMemoryBrandingStorage.bucket,
          objectKey: `tenant/${otherTenantId}/logo/original/foreign.png`,
          contentType: 'image/png',
          sizeBytes: 10,
          sha256: 'c'.repeat(64),
          scanStatus: 'PENDING_UPLOAD',
          processingStatus: 'PENDING_UPLOAD',
        },
      });

      const res = await finalizeLogo(ownerToken, foreign.id, 1);
      expect(res.status).toBe(404);
      const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: foreign.id } });
      expect(outbox).toHaveLength(0);

      await prisma.mediaObject.delete({ where: { id: foreign.id } }).catch(() => {});
    });

    it('status with a foreign media id leaks nothing (same as a fabricated id)', async () => {
      const fabricated = await logoStatus(ownerToken, randomUUID());
      expect(fabricated.status).toBe(200);
      expect(fabricated.body.data).toMatchObject({ mediaObjectId: null, processingStatus: 'NONE' });
    });
  });

  describe('Happy path: intent → finalize → worker attach → remove', () => {
    let mediaId: string;
    let objectKey: string;
    const contentHash = 'b'.repeat(64);
    const sizeBytes = 4096;

    it('finalizes into PENDING_PROCESSING with a pointer-only outbox row in one transaction', async () => {
      await expirePendingIntents();
      const intent = await uploadIntent(ownerToken, 1, { sha256: contentHash, sizeBytes });
      expect(intent.status).toBe(201);
      mediaId = intent.body.data.mediaObjectId;
      objectKey = (await prisma.mediaObject.findUnique({ where: { id: mediaId } }))!.objectKey;

      inMemoryBrandingStorage.simulateUpload(objectKey, sizeBytes, 'image/png', contentHash);

      const fin = await finalizeLogo(ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data).toMatchObject({
        mediaObjectId: mediaId,
        processingStatus: 'PENDING_PROCESSING',
        logo: null,
        tenantVersion: 1,
      });

      const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(media).toMatchObject({
        processingStatus: 'PENDING_PROCESSING',
        scanStatus: 'PENDING_SCAN',
        expectedItemVersion: 1,
      });

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' },
      });
      expect(outbox).toHaveLength(1);
      expect(outbox[0].branchId).toBeNull();
      expect(outbox[0].publishedAt).toBeNull();
      expect(outbox[0].payload).toEqual({ mediaObjectId: mediaId });
      expect(Object.keys(outbox[0].payload as object)).toEqual(['mediaObjectId']);
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });

    it('duplicate finalize is idempotent and never adds a second outbox row', async () => {
      const fin = await finalizeLogo(ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data.processingStatus).toBe('PENDING_PROCESSING');

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' },
      });
      expect(outbox).toHaveLength(1);
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });

    it('status reflects the claimed processing state', async () => {
      const res = await logoStatus(ownerToken, mediaId);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        mediaObjectId: mediaId,
        processingStatus: 'PENDING_PROCESSING',
        logo: null,
        tenantVersion: 1,
      });
    });

    it('duplicate finalize after the worker attached the logo still succeeds (version guard is bypassed for terminal states)', async () => {
      // Simulate the worker's CAS attach transaction.
      const tenant = (await prisma.tenant.findUnique({ where: { id: tenantId } }))!;
      const attached = await prisma.tenant.updateMany({
        where: { id: tenantId, version: tenant.version },
        data: { logoMediaId: mediaId, version: { increment: 1 } },
      });
      expect(attached.count).toBe(1);
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'READY',
          scanStatus: 'CLEAN',
          cdnKeyBase: 'logos/secret-token-0123456789abcdef',
          outputWidth: 512,
          outputHeight: 512,
          outputFormat: 'png',
          processedAt: new Date(),
        },
      });

      // Tenant version is now 2 while the client still holds 1: the idempotent
      // short-circuit must win over the stale-version conflict.
      const fin = await finalizeLogo(ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data.processingStatus).toBe('READY');

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: mediaId },
      });
      expect(outbox).toHaveLength(1);
    });

    it('status exposes secret-key CDN derivative URLs once READY', async () => {
      const res = await logoStatus(ownerToken);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        mediaObjectId: mediaId,
        processingStatus: 'READY',
        tenantVersion: 2,
      });
      expect(res.body.data.logo).toEqual({
        icon192: 'https://media.example.test/logos/secret-token-0123456789abcdef/192x192.png',
        icon512: 'https://media.example.test/logos/secret-token-0123456789abcdef/512x512.png',
        maskable512:
          'https://media.example.test/logos/secret-token-0123456789abcdef/512x512-maskable.png',
        apple180: 'https://media.example.test/logos/secret-token-0123456789abcdef/180x180.png',
        thumbnail: 'https://media.example.test/logos/secret-token-0123456789abcdef/320x320.webp',
      });
      const urls = JSON.stringify(res.body.data.logo);
      expect(urls).not.toContain(tenantId);
      expect(urls).not.toContain(mediaId);
    });

    it('rejects a stale remove and preserves the attached logo', async () => {
      const res = await removeLogo(ownerToken, 1);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('refresh');
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(tenant!.logoMediaId).toBe(mediaId);
      expect(tenant!.version).toBe(2);
    });

    it('removing the logo detaches it with a version CAS and schedules media cleanup', async () => {
      const res = await removeLogo(ownerToken, 2);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true, tenantVersion: 3 });

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(tenant!.logoMediaId).toBeNull();
      expect(tenant!.version).toBe(3);

      const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(media!.cleanupAfter).toBeInstanceOf(Date);
      expect(media!.cleanupAfter!.getTime()).toBeGreaterThan(Date.now());

      const status = await logoStatus(ownerToken);
      expect(status.body.data).toMatchObject({
        mediaObjectId: null,
        processingStatus: 'NONE',
        tenantVersion: 3,
      });
    });
  });

  describe('Concurrent finalize', () => {
    it('two parallel finalizes produce exactly one outbox row and both succeed', async () => {
      await expirePendingIntents();
      const contentHash = 'c'.repeat(64);
      const sizeBytes = 777;
      const intent = await uploadIntent(ownerToken, 3, { sha256: contentHash, sizeBytes });
      expect(intent.status).toBe(201);
      const mediaId = intent.body.data.mediaObjectId;
      const media = (await prisma.mediaObject.findUnique({ where: { id: mediaId } }))!;
      inMemoryBrandingStorage.simulateUpload(media.objectKey, sizeBytes, 'image/png', contentHash);

      const [r1, r2] = await Promise.all([
        finalizeLogo(ownerToken, mediaId, 3),
        finalizeLogo(ownerToken, mediaId, 3),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const outbox = await prisma.outboxEvent.findMany({
        where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' },
      });
      expect(outbox).toHaveLength(1);
      const mediaAfter = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(mediaAfter!.processingStatus).toBe('PENDING_PROCESSING');
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });
  });

  describe('Validation and conflicts', () => {
    it('caps concurrent active logo intents at two (tenant-wide)', async () => {
      await expirePendingIntents();
      expect((await uploadIntent(ownerToken, 3)).status).toBe(201);
      expect((await uploadIntent(ownerToken, 3)).status).toBe(201);
      const third = await uploadIntent(ownerToken, 3);
      expect(third.status).toBe(409);
      expect(third.body.message).toContain('Too many active logo uploads');
    });

    it('rejects a stale expectedVersion on upload-intent without creating rows', async () => {
      await expirePendingIntents();
      const before = await prisma.mediaObject.count({
        where: { tenantId, purpose: 'TENANT_LOGO' },
      });
      const res = await uploadIntent(ownerToken, 99);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('refresh');
      const after = await prisma.mediaObject.count({ where: { tenantId, purpose: 'TENANT_LOGO' } });
      expect(after).toBe(before);
    });

    it('rejects a stale expectedVersion on finalize', async () => {
      await expirePendingIntents();
      const intent = await uploadIntent(ownerToken, 3);
      expect(intent.status).toBe(201);
      const mediaId = intent.body.data.mediaObjectId;
      inMemoryBrandingStorage.simulateUpload(
        (await prisma.mediaObject.findUnique({ where: { id: mediaId } }))!.objectKey,
        256,
        'image/png',
        'a'.repeat(64),
      );
      const res = await finalizeLogo(ownerToken, mediaId, 99);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('refresh');
      const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: mediaId } });
      expect(outbox).toHaveLength(0);
    });

    it('rejects an expired upload intent', async () => {
      await expirePendingIntents();
      const intent = await uploadIntent(ownerToken, 3);
      expect(intent.status).toBe(201);
      const mediaId = intent.body.data.mediaObjectId;
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { uploadExpiresAt: new Date(Date.now() - 60_000) },
      });
      const res = await finalizeLogo(ownerToken, mediaId, 3);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('expired');
    });

    it('rejects finalize when the object was never uploaded', async () => {
      await expirePendingIntents();
      const intent = await uploadIntent(ownerToken, 3);
      expect(intent.status).toBe(201);
      const res = await finalizeLogo(ownerToken, intent.body.data.mediaObjectId, 3);
      expect(res.status).toBe(400);
      const outbox = await prisma.outboxEvent.findMany({
        where: { aggregateId: intent.body.data.mediaObjectId },
      });
      expect(outbox).toHaveLength(0);
    });

    it('rejects unsupported types and oversized payloads at the storage boundary, leaving no rows', async () => {
      await expirePendingIntents();
      const before = await prisma.mediaObject.count({
        where: { tenantId, purpose: 'TENANT_LOGO' },
      });
      const gif = await uploadIntent(ownerToken, 3, { contentType: 'image/gif' });
      expect(gif.status).toBe(400);
      expect(gif.body.message).toContain('Unsupported logo image');
      const oversized = await uploadIntent(ownerToken, 3, { sizeBytes: 10 * 1024 * 1024 + 1 });
      expect(oversized.status).toBe(400);
      const after = await prisma.mediaObject.count({ where: { tenantId, purpose: 'TENANT_LOGO' } });
      expect(after).toBe(before);
    });

    it('returns 404 for a fabricated media object id', async () => {
      const res = await finalizeLogo(ownerToken, randomUUID(), 3);
      expect(res.status).toBe(404);
    });
  });
});
