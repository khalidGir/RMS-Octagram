import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Nest DI needs the runtime class metadata
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { randomBytes } from 'crypto';

type Crop = { x: number; y: number; width: number; height: number; rotation?: number };
const OUTPUTS = [[320, 240], [640, 480], [1280, 960]] as const;
const LEASE_MS = 4 * 60_000; // < SQS visibility (300s) so a crashed job can be reclaimed on redelivery
const CLEANUP_INTERVAL_MS = 60 * 60_000;
const CLEANUP_GRACE_MS = 7 * 86_400_000;
const prisma = new PrismaClient();

/**
 * Failure that retrying cannot fix (bad pixels, vanished target, version
 * conflict). The job is marked REJECTED and the SQS message is deleted.
 * Everything else is treated as transient: the lease is released, the row is
 * reset to PENDING_PROCESSING, and the error is rethrown so SQS redelivers.
 */
export class PermanentImageError extends Error {}

export type JobOutcome = 'COMPLETED' | 'REJECTED' | 'SKIPPED' | 'IN_FLIGHT';

@Injectable()
export class MenuImageProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MenuImageProcessor.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    // No fallback to the payment-proof bucket: processing must fail visibly
    // until S3_MEDIA_BUCKET is configured (transient — retried by SQS).
    this.bucket = config.get<string>('S3_MEDIA_BUCKET') ?? '';
    this.s3 = new S3Client({ region: config.get<string>('S3_REGION', 'us-east-1'), ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.sweep(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * Processes one job addressed by an SQS message. The message body is only a
   * pointer: every tenant/item association is derived from the loaded record.
   * Returns IN_FLIGHT without touching the row when another worker holds a
   * live lease — the caller must NOT delete the SQS message in that case.
   */
  async handleJob(mediaObjectId: string): Promise<JobOutcome> {
    const media = await prisma.mediaObject.findUnique({ where: { id: mediaObjectId } });
    if (!media || media.purpose !== 'MENU_ITEM_IMAGE' || media.deletedAt) return 'SKIPPED';
    if (media.processingStatus === 'READY' || media.processingStatus === 'REJECTED' || media.processingStatus === 'PENDING_UPLOAD') return 'SKIPPED';

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    let claimed = false;
    if (media.processingStatus === 'PENDING_PROCESSING') {
      claimed = (await prisma.mediaObject.updateMany({
        where: { id: media.id, processingStatus: 'PENDING_PROCESSING' },
        data: { processingStatus: 'PROCESSING', processingStartedAt: now, processingLeaseExpiresAt: leaseUntil, processingAttempt: { increment: 1 } },
      })).count === 1;
    } else {
      // PROCESSING: reclaim only after the lease expired (worker crash).
      const leaseLive = media.processingLeaseExpiresAt && media.processingLeaseExpiresAt > now;
      if (leaseLive) return 'IN_FLIGHT';
      claimed = (await prisma.mediaObject.updateMany({
        where: { id: media.id, processingStatus: 'PROCESSING', OR: [{ processingLeaseExpiresAt: null }, { processingLeaseExpiresAt: { lt: now } }] },
        data: { processingStartedAt: media.processingStartedAt ?? now, processingLeaseExpiresAt: leaseUntil, processingAttempt: { increment: 1 } },
      })).count === 1;
    }
    if (!claimed) return 'IN_FLIGHT';

    const uploadedKeys: string[] = [];
    try {
      await this.render(media, uploadedKeys);
      return 'COMPLETED';
    } catch (error) {
      for (const key of uploadedKeys) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'Image processing failed';
      if (error instanceof PermanentImageError) {
        await prisma.mediaObject.updateMany({
          where: { id: media.id, processingStatus: 'PROCESSING' },
          data: { processingStatus: 'REJECTED', scanStatus: 'REJECTED', rejectionReason: reason, processingLeaseExpiresAt: null, cleanupAfter: new Date(Date.now() + CLEANUP_GRACE_MS) },
        });
        this.logger.warn(`Rejected menu image ${media.id}: ${reason}`);
        return 'REJECTED';
      }
      // Transient failure: release the lease and reset before rethrowing so
      // the redelivered message can claim a clean PENDING_PROCESSING row.
      await prisma.mediaObject.updateMany({
        where: { id: media.id, processingStatus: 'PROCESSING' },
        data: { processingStatus: 'PENDING_PROCESSING', processingStartedAt: null, processingLeaseExpiresAt: null },
      });
      throw error;
    }
  }

  private async render(media: { id: string; tenantId: string; targetMenuItemId: string | null; objectKey: string; sha256: string | null; cropData: unknown; expectedItemVersion: number | null; uploadedByUserId: string | null }, uploadedKeys: string[]) {
    if (!this.bucket) throw new Error('S3_MEDIA_BUCKET is not configured; menu image processing is disabled');
    if (!media.targetMenuItemId || !media.sha256) throw new PermanentImageError('Menu image record is incomplete');
    // S3 read: network/server failures stay transient (rethrown by handleJob).
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: media.objectKey }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());

    // Decode and validation failures are permanent: the bytes matched the
    // uploaded hash, so a retry cannot turn them into a valid photo.
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(bytes, { animated: false, limitInputPixels: 144_000_000 }).metadata();
    } catch {
      throw new PermanentImageError('Uploaded file could not be decoded as an image');
    }
    if (!metadata.width || !metadata.height || metadata.width < 800 || metadata.height < 600 || metadata.width > 12_000 || metadata.height > 12_000 || (metadata.pages ?? 1) > 1) {
      throw new PermanentImageError('Image must be a non-animated photo between 800×600 and 12000×12000 pixels');
    }

    const crop = (media.cropData ?? null) as Crop | null;
    const rotation = crop?.rotation ?? 0;
    // Pipeline ops do not affect sharp().metadata(), so derive the post-EXIF,
    // post-rotation dimensions explicitly before computing the crop rect.
    let width = metadata.width;
    let height = metadata.height;
    if ([5, 6, 7, 8].includes(metadata.orientation ?? 1)) [width, height] = [height, width];
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
    const normalized = crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const left = Math.max(0, Math.min(width - 1, Math.round(normalized.x * width)));
    const top = Math.max(0, Math.min(height - 1, Math.round(normalized.y * height)));
    const extractWidth = Math.max(1, Math.min(width - left, Math.round(normalized.width * width)));
    const extractHeight = Math.max(1, Math.min(height - top, Math.round(normalized.height * height)));

    // Content-versioned public key: item id is already public, the token is
    // random per processing run — no tenant id, no media id (audit rule).
    const publicToken = randomBytes(16).toString('base64url');
    const base = `menu-items/${media.targetMenuItemId}/${publicToken}-${media.sha256.slice(0, 12)}`;

    // Encode all derivatives first (sharp failures are permanent), then
    // upload (S3 failures are transient and leave no partial state behind).
    const outputs: Array<{ key: string; body: Buffer }> = [];
    for (const [outWidth, outHeight] of OUTPUTS) {
      try {
        const body = await sharp(bytes, { animated: false, limitInputPixels: 144_000_000 })
          .rotate().rotate(rotation)
          .extract({ left, top, width: extractWidth, height: extractHeight })
          .resize(outWidth, outHeight, { fit: 'cover', position: 'centre' })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
        outputs.push({ key: `public/${base}/${outWidth}x${outHeight}.webp`, body });
      } catch (error) {
        throw new PermanentImageError(error instanceof Error ? error.message.slice(0, 500) : 'Image processing failed');
      }
    }
    for (const output of outputs) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket, Key: output.key, Body: output.body, ContentType: 'image/webp',
        CacheControl: 'public,max-age=31536000,immutable',
        Metadata: { menuItemId: media.targetMenuItemId },
      }));
      uploadedKeys.push(output.key);
    }

    await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.findFirst({ where: { id: media.targetMenuItemId!, tenantId: media.tenantId, deletedAt: null } });
      if (!item) throw new PermanentImageError('Target menu item no longer exists');
      // Version-protected attach: a remove/edit during processing wins and the
      // uploaded image is rejected instead of resurrecting stale state.
      if (media.expectedItemVersion == null || item.version !== media.expectedItemVersion) {
        throw new PermanentImageError('Menu item changed during processing; upload again');
      }
      const attached = await tx.menuItem.updateMany({
        where: { id: item.id, tenantId: media.tenantId, version: media.expectedItemVersion },
        data: { imageMediaId: media.id, version: { increment: 1 } },
      });
      if (attached.count !== 1) throw new PermanentImageError('Menu item changed during processing; upload again');
      await tx.mediaObject.update({
        where: { id: media.id },
        data: {
          processingStatus: 'READY', scanStatus: 'CLEAN',
          originalWidth: metadata.width, originalHeight: metadata.height,
          outputWidth: 1280, outputHeight: 960, outputFormat: 'webp',
          cdnKeyBase: base, processedAt: new Date(), rejectionReason: null,
          processingLeaseExpiresAt: null, cleanupAfter: null,
        },
      });
      if (item.imageMediaId && item.imageMediaId !== media.id) {
        await tx.mediaObject.updateMany({
          where: { id: item.imageMediaId, tenantId: media.tenantId },
          data: { cleanupAfter: new Date(Date.now() + CLEANUP_GRACE_MS) },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: media.uploadedByUserId ?? null, tenantId: media.tenantId,
          action: 'MENU_IMAGE_PROCESS_COMPLETE', entityType: 'MediaObject', entityId: media.id,
          afterJson: { menuItemId: item.id, cdnKeyBase: base },
        },
      });
    });
  }

  /**
   * Hourly janitor: removes replaced/removed/rejected media after the 7-day
   * grace period, abandoned upload intents, and dead jobs — always skipping
   * any media object still attached to a menu item.
   */
  async sweep() {
    try {
      const staleIntentCutoff = new Date(Date.now() - CLEANUP_GRACE_MS);
      const expired = await prisma.mediaObject.findMany({
        where: {
          purpose: 'MENU_ITEM_IMAGE', deletedAt: null,
          OR: [
            { cleanupAfter: { lte: new Date() } },
            { processingStatus: 'PENDING_UPLOAD', uploadExpiresAt: { lte: staleIntentCutoff } },
            { processingStatus: { in: ['PENDING_PROCESSING', 'PROCESSING'] }, createdAt: { lte: staleIntentCutoff } },
          ],
        },
        take: 10,
      });
      for (const media of expired) {
        const active = await prisma.menuItem.count({ where: { imageMediaId: media.id } });
        if (active) continue;
        const keys = [
          media.objectKey,
          ...(media.cdnKeyBase ? OUTPUTS.map(([w, h]) => `public/${media.cdnKeyBase}/${w}x${h}.webp`) : []),
        ].filter((key) => key.length > 0);
        for (const key of keys) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
        await prisma.mediaObject.update({ where: { id: media.id }, data: { deletedAt: new Date() } });
      }
    } catch (error) {
      this.logger.error(`Menu image cleanup sweep failed: ${String(error)}`);
    }
  }
}
