import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BrandingService } from './branding.service';

describe('BrandingService', () => {
  const prisma = {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
    mediaObject: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    outboxEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const storage = { bucket: 'private-media', createUpload: vi.fn(), verifyObject: vi.fn() };
  const config = {
    get: vi.fn((key: string) =>
      key === 'MEDIA_CDN_URL' ? 'https://media.example.test/' : undefined,
    ),
  };
  let service: BrandingService;

  const tenantRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'tenant-a',
    version: 1,
    logoMediaId: null,
    logoMedia: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrandingService(
      prisma as never,
      audit as never,
      storage as never,
      config as never,
    );
  });

  describe('view', () => {
    it('exposes all five derivative URLs only for ready media', () => {
      expect(service.view({ processingStatus: 'READY', cdnKeyBase: 'logos/tok-abc123' })).toEqual({
        icon192: 'https://media.example.test/logos/tok-abc123/192x192.png',
        icon512: 'https://media.example.test/logos/tok-abc123/512x512.png',
        maskable512: 'https://media.example.test/logos/tok-abc123/512x512-maskable.png',
        apple180: 'https://media.example.test/logos/tok-abc123/180x180.png',
        thumbnail: 'https://media.example.test/logos/tok-abc123/320x320.webp',
      });
    });

    it('never exposes pending, rejected, or missing media', () => {
      expect(service.view({ processingStatus: 'PROCESSING', cdnKeyBase: 'secret' })).toBeNull();
      expect(service.view({ processingStatus: 'REJECTED', cdnKeyBase: 'secret' })).toBeNull();
      expect(service.view(null)).toBeNull();
      expect(service.view(undefined)).toBeNull();
    });
  });

  describe('createUploadIntent', () => {
    const body = {
      contentType: 'image/png',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      crop: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      expectedVersion: 1,
    };

    it('rejects a missing restaurant before creating an intent', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.createUploadIntent('tenant-a', 'owner', body)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.mediaObject.create).not.toHaveBeenCalled();
    });

    it('enforces the optimistic tenant version', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 3 }));
      await expect(
        service.createUploadIntent('tenant-a', 'owner', { ...body, expectedVersion: 2 }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.mediaObject.create).not.toHaveBeenCalled();
    });

    it('creates a tenant-scoped TENANT_LOGO intent with a presigned upload', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.count.mockResolvedValue(0);
      prisma.mediaObject.create.mockResolvedValue({ id: 'media-1' });
      prisma.mediaObject.update.mockResolvedValue({});
      storage.createUpload.mockResolvedValue({
        uploadUrl: 'https://s3',
        objectKey: 'private/key',
        fields: { key: 'private/key' },
      });

      const result = await service.createUploadIntent('tenant-a', 'owner', body);

      expect(prisma.mediaObject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-a',
            branchId: null,
            targetMenuItemId: null,
            purpose: 'TENANT_LOGO',
            processingStatus: 'PENDING_UPLOAD',
            scanStatus: 'PENDING_UPLOAD',
          }),
        }),
      );
      expect(result.mediaObjectId).toBe('media-1');
      expect(result.tenantVersion).toBe(1);
      expect(prisma.mediaObject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'media-1' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANDING_LOGO_UPLOAD_INTENT' }),
      );
    });

    it('removes the intent row when the storage layer rejects the request', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.count.mockResolvedValue(0);
      prisma.mediaObject.create.mockResolvedValue({ id: 'media-1' });
      storage.createUpload.mockRejectedValue(new Error('unsupported content type'));

      await expect(service.createUploadIntent('tenant-a', 'owner', body)).rejects.toThrow(
        'unsupported content type',
      );
      expect(prisma.mediaObject.deleteMany).toHaveBeenCalledWith({
        where: { id: 'media-1', processingStatus: 'PENDING_UPLOAD', objectKey: '' },
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('caps concurrent upload intents at two', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.count.mockResolvedValue(2);
      await expect(service.createUploadIntent('tenant-a', 'owner', body)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.mediaObject.create).not.toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    const pendingMedia = (overrides: Record<string, unknown> = {}) => ({
      id: 'media-1',
      tenantId: 'tenant-a',
      purpose: 'TENANT_LOGO',
      processingStatus: 'PENDING_UPLOAD',
      objectKey: 'private/key',
      contentType: 'image/png',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      uploadExpiresAt: new Date(Date.now() + 60_000),
      rejectionReason: null,
      cdnKeyBase: null,
      ...overrides,
    });

    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          mediaObject: { updateMany: prisma.mediaObject.updateMany },
          outboxEvent: { create: prisma.outboxEvent.create },
        }),
      );
      storage.verifyObject.mockResolvedValue(undefined);
    });

    it('rejects a cross-tenant media id', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.findFirst.mockResolvedValue(null);
      await expect(
        service.finalize('tenant-a', 'owner', 'media-of-other-tenant', 1),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(storage.verifyObject).not.toHaveBeenCalled();
    });

    it('claims the intent and writes a pointer-only outbox event atomically', async () => {
      const media = pendingMedia();
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.findFirst.mockResolvedValue(media);
      prisma.mediaObject.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.finalize('tenant-a', 'owner', 'media-1', 1);

      expect(result).toEqual({
        mediaObjectId: 'media-1',
        processingStatus: 'PENDING_PROCESSING',
        logo: null,
        tenantVersion: 1,
      });
      expect(prisma.mediaObject.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'media-1',
            processingStatus: 'PENDING_UPLOAD',
            uploadExpiresAt: { gt: expect.any(Date) },
          },
          data: expect.objectContaining({
            processingStatus: 'PENDING_PROCESSING',
            scanStatus: 'PENDING_SCAN',
            expectedItemVersion: 1,
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'menu.image.process_requested',
          payload: { mediaObjectId: 'media-1' },
        }),
      });
      expect(
        Object.keys(
          (prisma.outboxEvent.create.mock.calls[0][0] as { data: { payload: object } }).data
            .payload,
        ),
      ).toEqual(['mediaObjectId']);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANDING_LOGO_UPLOAD_FINALIZED' }),
      );
    });

    it('enforces the tenant version only after the idempotent-state check', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 5 }));
      prisma.mediaObject.findFirst.mockResolvedValue(pendingMedia());
      await expect(service.finalize('tenant-a', 'owner', 'media-1', 4)).rejects.toThrow(
        ConflictException,
      );
      expect(storage.verifyObject).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired intent', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.findFirst.mockResolvedValue(
        pendingMedia({ uploadExpiresAt: new Date(Date.now() - 1_000) }),
      );
      await expect(service.finalize('tenant-a', 'owner', 'media-1', 1)).rejects.toThrow(
        ConflictException,
      );
      expect(storage.verifyObject).not.toHaveBeenCalled();
    });

    it('returns the status without a version guard for an already-processed duplicate', async () => {
      const readyMedia = pendingMedia({
        processingStatus: 'READY',
        cdnKeyBase: 'logos/tok-abc123',
      });
      prisma.tenant.findUnique.mockResolvedValue(
        tenantRow({ version: 9, logoMediaId: 'media-1', logoMedia: readyMedia }),
      );
      prisma.mediaObject.findFirst.mockResolvedValue(readyMedia);

      const result = await service.finalize('tenant-a', 'owner', 'media-1', 1);

      expect(result).toMatchObject({ processingStatus: 'READY', tenantVersion: 9 });
      expect(result.logo).toMatchObject({
        icon192: 'https://media.example.test/logos/tok-abc123/192x192.png',
      });
      expect(storage.verifyObject).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANDING_LOGO_UPLOAD_FINALIZED' }),
      );
    });

    it('falls back to status when a concurrent claim wins the race', async () => {
      const media = pendingMedia();
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      prisma.mediaObject.findFirst.mockResolvedValue(media);
      prisma.mediaObject.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.finalize('tenant-a', 'owner', 'media-1', 1);

      expect(result.processingStatus).toBe('PENDING_UPLOAD');
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANDING_LOGO_UPLOAD_FINALIZED' }),
      );
    });
  });

  describe('status', () => {
    it('reports NONE and the tenant version when no logo exists', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow());
      const result = await service.status('tenant-a');
      expect(result).toEqual({
        mediaObjectId: null,
        processingStatus: 'NONE',
        rejectionReason: null,
        logo: null,
        tenantVersion: 1,
      });
    });

    it('scopes the requested media to the tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 4 }));
      prisma.mediaObject.findFirst.mockResolvedValue({
        id: 'media-2',
        tenantId: 'tenant-a',
        purpose: 'TENANT_LOGO',
        processingStatus: 'PROCESSING',
        rejectionReason: null,
        cdnKeyBase: null,
      });
      const result = await service.status('tenant-a', 'media-2');
      expect(prisma.mediaObject.findFirst).toHaveBeenCalledWith({
        where: { id: 'media-2', tenantId: 'tenant-a', purpose: 'TENANT_LOGO' },
      });
      expect(result.processingStatus).toBe('PROCESSING');
      expect(result.tenantVersion).toBe(4);
    });

    it('throws for a missing restaurant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.status('tenant-a')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('detaches the logo with a version CAS and schedules old media cleanup', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 2, logoMediaId: 'media-1' }));
      prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
      prisma.mediaObject.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('tenant-a', 'owner', 2);

      expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: 'tenant-a', version: 2 },
        data: { logoMediaId: null, version: { increment: 1 } },
      });
      expect(prisma.mediaObject.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'media-1', tenantId: 'tenant-a' },
          data: { cleanupAfter: expect.any(Date) },
        }),
      );
      expect(result).toEqual({ success: true, tenantVersion: 3 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANDING_LOGO_REMOVE' }),
      );
    });

    it('rejects a stale version without touching the tenant or media', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 7 }));
      prisma.tenant.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('tenant-a', 'owner', 5)).rejects.toThrow(ConflictException);
      expect(prisma.mediaObject.updateMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('succeeds for a tenant without a logo', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenantRow({ version: 1 }));
      prisma.tenant.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('tenant-a', 'owner', 1);
      expect(result).toEqual({ success: true, tenantVersion: 2 });
      expect(prisma.mediaObject.updateMany).not.toHaveBeenCalled();
    });
  });
});
