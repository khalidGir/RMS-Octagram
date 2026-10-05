import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MenuImageService } from './menu-image.service';

describe('MenuImageService', () => {
  const prisma = {
    menuItem: { findFirst: vi.fn(), updateMany: vi.fn() },
    mediaObject: { count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    outboxEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const storage = { bucket: 'private-media', createUpload: vi.fn(), verifyObject: vi.fn() };
  const config = { get: vi.fn((key: string) => key === 'MEDIA_CDN_URL' ? 'https://media.example.test/' : undefined) };
  let service: MenuImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MenuImageService(prisma as never, audit as never, storage as never, config as never);
  });

  it('returns only stable CDN derivative data for ready media', () => {
    expect(service.view({ processingStatus: 'READY', cdnKeyBase: 'tenant/t/item/i', outputWidth: 1280, outputHeight: 960 })).toEqual({
      thumbnailUrl: 'https://media.example.test/tenant/t/item/i/320x240.webp',
      standardUrl: 'https://media.example.test/tenant/t/item/i/640x480.webp',
      highResolutionUrl: 'https://media.example.test/tenant/t/item/i/1280x960.webp',
      width: 1280, height: 960,
    });
  });

  it('does not expose pending or rejected media', () => {
    expect(service.view({ processingStatus: 'PROCESSING', cdnKeyBase: 'secret', outputWidth: null, outputHeight: null })).toBeNull();
  });

  it('rejects a cross-tenant or missing item before creating an intent', async () => {
    prisma.menuItem.findFirst.mockResolvedValue(null);
    await expect(service.createUploadIntent('tenant-a', 'item-b', 'owner', { contentType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1 })).rejects.toThrow(NotFoundException);
    expect(prisma.mediaObject.create).not.toHaveBeenCalled();
  });

  it('enforces optimistic item version on upload', async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 3 });
    await expect(service.createUploadIntent('tenant', 'item', 'owner', { contentType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 2 })).rejects.toThrow(ConflictException);
  });

  it('creates a tenant-scoped private upload intent', async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 1 });
    prisma.mediaObject.count.mockResolvedValue(0);
    prisma.mediaObject.create.mockResolvedValue({ id: 'media' });
    storage.createUpload.mockResolvedValue({ uploadUrl: 'https://s3', objectKey: 'private/key', fields: { key: 'private/key' } });
    const result = await service.createUploadIntent('tenant', 'item', 'owner', { contentType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1 });
    expect(result.mediaObjectId).toBe('media');
    expect(prisma.mediaObject.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant', branchId: null, targetMenuItemId: 'item', purpose: 'MENU_ITEM_IMAGE' }) }));
  });

  it('keeps removal version-protected and schedules old media cleanup', async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 4, imageMediaId: 'old-media' });
    prisma.menuItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.mediaObject.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.remove('tenant', 'item', 'manager', 4)).resolves.toEqual({ success: true, itemVersion: 5 });
    expect(prisma.menuItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item', tenantId: 'tenant', version: 4 } }));
    expect(prisma.mediaObject.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old-media', tenantId: 'tenant' } }));
  });

  describe('finalize', () => {
    const pendingMedia = {
      id: 'media', tenantId: 'tenant', targetMenuItemId: 'item', purpose: 'MENU_ITEM_IMAGE',
      processingStatus: 'PENDING_UPLOAD', objectKey: 'private/key', contentType: 'image/jpeg',
      sizeBytes: BigInt(100), sha256: 'a'.repeat(64), uploadExpiresAt: new Date(Date.now() + 60_000),
      rejectionReason: null, cdnKeyBase: null, outputWidth: null, outputHeight: null,
    };

    beforeEach(() => {
      // Transaction double: runs the callback with a tx that records the
      // outbox write, so the test asserts the atomic state+outbox contract.
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ mediaObject: { updateMany: prisma.mediaObject.updateMany }, outboxEvent: { create: prisma.outboxEvent.create } }));
      storage.verifyObject.mockResolvedValue(undefined);
    });

    it('claims PENDING_UPLOAD and writes a pointer-only outbox event in one transaction', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 1 });
      prisma.mediaObject.findFirst.mockResolvedValue(pendingMedia);
      prisma.mediaObject.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.finalize('tenant', 'item', 'owner', 'media', 1);

      expect(result).toEqual({ mediaObjectId: 'media', processingStatus: 'PENDING_PROCESSING', image: null });
      expect(prisma.mediaObject.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'media', processingStatus: 'PENDING_UPLOAD', uploadExpiresAt: { gt: expect.any(Date) } },
        data: expect.objectContaining({ processingStatus: 'PENDING_PROCESSING', scanStatus: 'PENDING_SCAN', expectedItemVersion: 1 }),
      }));
      expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'menu.image.process_requested',
          payload: { mediaObjectId: 'media' },
        }),
      });
      expect(Object.keys((prisma.outboxEvent.create.mock.calls[0][0] as { data: { payload: object } }).data.payload)).toEqual(['mediaObjectId']);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'MENU_IMAGE_UPLOAD_FINALIZED' }));
    });

    it('is idempotent for an already-processed duplicate, skipping the version guard', async () => {
      const readyMedia = { ...pendingMedia, processingStatus: 'READY', cdnKeyBase: 'menu-items/item/tok', outputWidth: 1280, outputHeight: 960 };
      prisma.menuItem.findFirst.mockImplementation(async ({ include }: { include?: unknown }) =>
        include
          ? { id: 'item', version: 9, imageMedia: readyMedia }
          : { id: 'item', version: 9 });
      prisma.mediaObject.findFirst.mockResolvedValue(readyMedia);

      const result = await service.finalize('tenant', 'item', 'owner', 'media', 1);

      expect(result.processingStatus).toBe('READY');
      expect(result.itemVersion).toBe(9);
      expect(result.image).toMatchObject({ thumbnailUrl: 'https://media.example.test/menu-items/item/tok/320x240.webp' });
      expect(storage.verifyObject).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'MENU_IMAGE_UPLOAD_FINALIZED' }));
    });

    it('rejects a stale item version before verifying or claiming', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 3 });
      prisma.mediaObject.findFirst.mockResolvedValue(pendingMedia);

      await expect(service.finalize('tenant', 'item', 'owner', 'media', 1)).rejects.toThrow(ConflictException);
      expect(storage.verifyObject).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired upload intent', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 1 });
      prisma.mediaObject.findFirst.mockResolvedValue({ ...pendingMedia, uploadExpiresAt: new Date(Date.now() - 1_000) });

      await expect(service.finalize('tenant', 'item', 'owner', 'media', 1)).rejects.toThrow('expired');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates storage verification failure without entering the claim', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 1 });
      prisma.mediaObject.findFirst.mockResolvedValue(pendingMedia);
      storage.verifyObject.mockRejectedValue(new BadRequestException('Uploaded image does not match its upload intent'));

      await expect(service.finalize('tenant', 'item', 'owner', 'media', 1)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('loses the CAS race gracefully: no outbox row, reports current status', async () => {
      prisma.menuItem.findFirst.mockImplementation(async ({ include }: { include?: unknown }) =>
        include ? { id: 'item', version: 1, imageMedia: null } : { id: 'item', version: 1 });
      prisma.mediaObject.findFirst
        .mockResolvedValueOnce(pendingMedia)
        .mockResolvedValueOnce({ ...pendingMedia, processingStatus: 'PROCESSING' });
      prisma.mediaObject.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.finalize('tenant', 'item', 'owner', 'media', 1);

      expect(result.processingStatus).toBe('PROCESSING');
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'MENU_IMAGE_UPLOAD_FINALIZED' }));
    });

    it('throws 404 for a cross-tenant or mismatched media object', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item', version: 1 });
      prisma.mediaObject.findFirst.mockResolvedValue(null);

      await expect(service.finalize('tenant', 'item', 'owner', 'media', 1)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
