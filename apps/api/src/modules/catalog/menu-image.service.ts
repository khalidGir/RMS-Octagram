import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MenuImageStorageService } from './menu-image-storage.service';
import type { CreateMenuImageUploadDto } from './dto';

export interface MenuItemImageView {
  thumbnailUrl: string;
  standardUrl: string;
  highResolutionUrl: string;
  width: number;
  height: number;
}

@Injectable()
export class MenuImageService {
  private readonly cdnBase: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MenuImageStorageService) private readonly storage: MenuImageStorageService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.cdnBase = (config.get<string>('MEDIA_CDN_URL') ?? '').replace(/\/$/, '');
  }

  view(media: { processingStatus: string; cdnKeyBase: string | null; outputWidth: number | null; outputHeight: number | null } | null | undefined): MenuItemImageView | null {
    if (!media || media.processingStatus !== 'READY' || !media.cdnKeyBase || !this.cdnBase) return null;
    const url = (size: string) => `${this.cdnBase}/${media.cdnKeyBase}/${size}.webp`;
    return { thumbnailUrl: url('320x240'), standardUrl: url('640x480'), highResolutionUrl: url('1280x960'), width: media.outputWidth ?? 1280, height: media.outputHeight ?? 960 };
  }

  async createUploadIntent(tenantId: string, itemId: string, actorUserId: string, body: CreateMenuImageUploadDto) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId, deletedAt: null } });
    if (!item) throw new NotFoundException('Menu item not found');
    if (item.version !== body.expectedVersion) throw new ConflictException('Menu item changed; refresh and retry');
    const activeIntents = await this.prisma.mediaObject.count({
      where: { tenantId, targetMenuItemId: itemId, purpose: 'MENU_ITEM_IMAGE', processingStatus: { in: ['PENDING_UPLOAD', 'PENDING_PROCESSING', 'PROCESSING'] }, uploadExpiresAt: { gt: new Date() } },
    });
    if (activeIntents >= 3) throw new ConflictException('Too many active image uploads');

    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const media = await this.prisma.mediaObject.create({
      data: {
        tenantId, branchId: null, paymentId: null, targetMenuItemId: itemId,
        purpose: 'MENU_ITEM_IMAGE', bucket: this.storage.bucket, objectKey: '',
        contentType: body.contentType, sizeBytes: BigInt(body.sizeBytes), sha256: body.sha256,
        scanStatus: 'PENDING_UPLOAD', processingStatus: 'PENDING_UPLOAD', cropData: body.crop as unknown as Prisma.InputJsonValue,
        uploadExpiresAt: expiresAt, uploadedByUserId: actorUserId,
      },
    });
    // If the storage layer rejects the request (type/size), the already-created
    // intent row must not linger: delete it before propagating so rejected
    // requests leave no state behind.
    let upload: Awaited<ReturnType<MenuImageStorageService['createUpload']>>;
    try {
      upload = await this.storage.createUpload({ tenantId, itemId, contentType: body.contentType, sizeBytes: body.sizeBytes, sha256: body.sha256 });
    } catch (error) {
      await this.prisma.mediaObject.deleteMany({ where: { id: media.id, processingStatus: 'PENDING_UPLOAD', objectKey: '' } });
      throw error;
    }
    await this.prisma.mediaObject.update({ where: { id: media.id }, data: { objectKey: upload.objectKey } });
    await this.audit.log({ actorUserId, tenantId, action: 'MENU_IMAGE_UPLOAD_INTENT', entityType: 'MediaObject', entityId: media.id, after: { itemId, contentType: body.contentType, sizeBytes: body.sizeBytes } });
    return { mediaObjectId: media.id, uploadUrl: upload.uploadUrl, fields: upload.fields, expiresAt };
  }

  async finalize(tenantId: string, itemId: string, actorUserId: string, mediaObjectId: string, expectedVersion: number) {
    const [item, media] = await Promise.all([
      this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId, deletedAt: null } }),
      this.prisma.mediaObject.findFirst({ where: { id: mediaObjectId, tenantId, targetMenuItemId: itemId, purpose: 'MENU_ITEM_IMAGE' } }),
    ]);
    if (!item || !media) throw new NotFoundException('Menu image upload not found');
    // Terminal and in-flight states are idempotent outcomes. Check them before
    // the version guard so a duplicate finalize after the worker attach (which
    // increments item.version) still succeeds instead of returning 409.
    if (media.processingStatus !== 'PENDING_UPLOAD') return this.status(tenantId, itemId, media.id);
    if (item.version !== expectedVersion) throw new ConflictException('Menu item changed; refresh and retry');
    if (!media.uploadExpiresAt || media.uploadExpiresAt < new Date()) throw new ConflictException('Image upload intent expired or is no longer usable');
    await this.storage.verifyObject({ objectKey: media.objectKey, sizeBytes: Number(media.sizeBytes), contentType: media.contentType, sha256: media.sha256! });
    // The state transition and the outbox row must commit together so a
    // processed job can never be lost between commit and publication.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaObject.updateMany({
        where: { id: media.id, processingStatus: 'PENDING_UPLOAD', uploadExpiresAt: { gt: new Date() } },
        data: { processingStatus: 'PENDING_PROCESSING', scanStatus: 'PENDING_SCAN', expectedItemVersion: expectedVersion },
      });
      if (result.count === 0) return false;
      await tx.outboxEvent.create({
        data: {
          tenantId, branchId: null, aggregateType: 'MediaObject', aggregateId: media.id,
          eventType: 'menu.image.process_requested', payload: { mediaObjectId: media.id },
        },
      });
      return true;
    });
    if (!claimed) return this.status(tenantId, itemId, media.id);
    await this.audit.log({ actorUserId, tenantId, action: 'MENU_IMAGE_UPLOAD_FINALIZED', entityType: 'MediaObject', entityId: media.id, after: { itemId } });
    return { mediaObjectId: media.id, processingStatus: 'PENDING_PROCESSING', image: null };
  }

  async status(tenantId: string, itemId: string, mediaObjectId?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId }, include: { imageMedia: true } });
    if (!item) throw new NotFoundException('Menu item not found');
    const media = mediaObjectId
      ? await this.prisma.mediaObject.findFirst({ where: { id: mediaObjectId, tenantId, targetMenuItemId: itemId, purpose: 'MENU_ITEM_IMAGE' } })
      : item.imageMedia;
    return { mediaObjectId: media?.id ?? null, processingStatus: media?.processingStatus ?? 'NONE', rejectionReason: media?.rejectionReason ?? null, image: this.view(media), itemVersion: item.version };
  }

  async remove(tenantId: string, itemId: string, actorUserId: string, expectedVersion: number) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, tenantId, deletedAt: null } });
    if (!item) throw new NotFoundException('Menu item not found');
    const updated = await this.prisma.menuItem.updateMany({ where: { id: itemId, tenantId, version: expectedVersion }, data: { imageMediaId: null, version: { increment: 1 } } });
    if (updated.count === 0) throw new ConflictException('Menu item changed; refresh and retry');
    if (item.imageMediaId) await this.prisma.mediaObject.updateMany({ where: { id: item.imageMediaId, tenantId }, data: { cleanupAfter: new Date(Date.now() + 7 * 86_400_000) } });
    await this.audit.log({ actorUserId, tenantId, action: 'MENU_IMAGE_REMOVE', entityType: 'MenuItem', entityId: itemId, before: { imageMediaId: item.imageMediaId } });
    return { success: true, itemVersion: expectedVersion + 1 };
  }
}
