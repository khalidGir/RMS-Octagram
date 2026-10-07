import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandingStorageService } from './branding-storage.service';
import { tenantLogoView, type TenantLogoView } from '../shared/logo-view';
import type { CreateLogoUploadDto } from './dto';

/**
 * Owner-only restaurant logo pipeline. Mirrors the menu-image flow (intent →
 * presigned upload → finalize → worker attach) but targets the Tenant row:
 * `Tenant.version` is the optimistic-concurrency slot and the worker attaches
 * the processed derivatives with a CAS on that version.
 */
@Injectable()
export class BrandingService {
  private readonly cdnBase: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BrandingStorageService) private readonly storage: BrandingStorageService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.cdnBase = (config.get<string>('MEDIA_CDN_URL') ?? '').replace(/\/$/, '');
  }

  view(
    media: { processingStatus: string; cdnKeyBase: string | null } | null | undefined,
  ): TenantLogoView | null {
    return tenantLogoView(this.cdnBase, media?.cdnKeyBase, media?.processingStatus);
  }

  private async loadTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { logoMedia: true },
    });
    if (!tenant) throw new NotFoundException('Restaurant not found');
    return tenant;
  }

  async createUploadIntent(tenantId: string, actorUserId: string, body: CreateLogoUploadDto) {
    const tenant = await this.loadTenant(tenantId);
    if (tenant.version !== body.expectedVersion)
      throw new ConflictException('Restaurant branding changed; refresh and retry');

    const expiresAt = new Date(Date.now() + 5 * 60_000);
    // Count and insert run in one transaction behind a per-tenant advisory
    // lock: without it, two concurrent requests can both observe a count
    // below the cap and both insert, exceeding the limit.
    const media = await this.prisma.$transaction(async (tx) => {
      // `IS NOT NULL` yields a boolean Prisma can deserialize (the lock call
      // itself returns void).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`logo-intent:${tenantId}`})::bigint) IS NOT NULL`;
      const activeIntents = await tx.mediaObject.count({
        where: {
          tenantId,
          purpose: 'TENANT_LOGO',
          processingStatus: { in: ['PENDING_UPLOAD', 'PENDING_PROCESSING', 'PROCESSING'] },
          uploadExpiresAt: { gt: new Date() },
        },
      });
      if (activeIntents >= 2) throw new ConflictException('Too many active logo uploads');
      return tx.mediaObject.create({
        data: {
          tenantId,
          branchId: null,
          paymentId: null,
          targetMenuItemId: null,
          purpose: 'TENANT_LOGO',
          bucket: this.storage.bucket,
          objectKey: '',
          contentType: body.contentType,
          sizeBytes: BigInt(body.sizeBytes),
          sha256: body.sha256,
          scanStatus: 'PENDING_UPLOAD',
          processingStatus: 'PENDING_UPLOAD',
          cropData: body.crop as unknown as Prisma.InputJsonValue,
          uploadExpiresAt: expiresAt,
          uploadedByUserId: actorUserId,
        },
      });
    });
    // If the storage layer rejects the request (type/size), the already-created
    // intent row must not linger: delete it before propagating so rejected
    // requests leave no state behind.
    let upload: Awaited<ReturnType<BrandingStorageService['createUpload']>>;
    try {
      upload = await this.storage.createUpload({
        tenantId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      });
    } catch (error) {
      await this.prisma.mediaObject.deleteMany({
        where: { id: media.id, processingStatus: 'PENDING_UPLOAD', objectKey: '' },
      });
      throw error;
    }
    await this.prisma.mediaObject.update({
      where: { id: media.id },
      data: { objectKey: upload.objectKey },
    });
    await this.audit.log({
      actorUserId,
      tenantId,
      action: 'BRANDING_LOGO_UPLOAD_INTENT',
      entityType: 'MediaObject',
      entityId: media.id,
      after: { contentType: body.contentType, sizeBytes: body.sizeBytes },
    });
    return {
      mediaObjectId: media.id,
      uploadUrl: upload.uploadUrl,
      fields: upload.fields,
      expiresAt,
      tenantVersion: tenant.version,
    };
  }

  async finalize(
    tenantId: string,
    actorUserId: string,
    mediaObjectId: string,
    expectedVersion: number,
  ) {
    const [tenant, media] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { logoMedia: true } }),
      this.prisma.mediaObject.findFirst({
        where: { id: mediaObjectId, tenantId, purpose: 'TENANT_LOGO' },
      }),
    ]);
    if (!tenant || !media) throw new NotFoundException('Logo upload not found');
    // Terminal and in-flight states are idempotent outcomes. Check them before
    // the version guard so a duplicate finalize after the worker attach (which
    // increments tenant.version) still succeeds instead of returning 409.
    if (media.processingStatus !== 'PENDING_UPLOAD') return this.status(tenantId, media.id);
    if (tenant.version !== expectedVersion)
      throw new ConflictException('Restaurant branding changed; refresh and retry');
    if (!media.uploadExpiresAt || media.uploadExpiresAt < new Date())
      throw new ConflictException('Logo upload intent expired or is no longer usable');
    await this.storage.verifyObject({
      objectKey: media.objectKey,
      sizeBytes: Number(media.sizeBytes),
      contentType: media.contentType,
      sha256: media.sha256!,
    });
    // The state transition and the outbox row must commit together so a
    // processed job can never be lost between commit and publication. The
    // shared media-image event carries only { mediaObjectId }; the worker
    // dispatches on the media row's purpose.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.mediaObject.updateMany({
        where: {
          id: media.id,
          processingStatus: 'PENDING_UPLOAD',
          uploadExpiresAt: { gt: new Date() },
        },
        data: {
          processingStatus: 'PENDING_PROCESSING',
          scanStatus: 'PENDING_SCAN',
          expectedItemVersion: expectedVersion,
        },
      });
      if (result.count === 0) return false;
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId: null,
          aggregateType: 'MediaObject',
          aggregateId: media.id,
          eventType: 'menu.image.process_requested',
          payload: { mediaObjectId: media.id },
        },
      });
      return true;
    });
    if (!claimed) return this.status(tenantId, media.id);
    await this.audit.log({
      actorUserId,
      tenantId,
      action: 'BRANDING_LOGO_UPLOAD_FINALIZED',
      entityType: 'MediaObject',
      entityId: media.id,
      after: { tenantVersion: expectedVersion },
    });
    return {
      mediaObjectId: media.id,
      processingStatus: 'PENDING_PROCESSING',
      logo: null,
      tenantVersion: expectedVersion,
    };
  }

  async status(tenantId: string, mediaObjectId?: string) {
    const tenant = await this.loadTenant(tenantId);
    const media = mediaObjectId
      ? await this.prisma.mediaObject.findFirst({
          where: { id: mediaObjectId, tenantId, purpose: 'TENANT_LOGO' },
        })
      : tenant.logoMedia;
    return {
      mediaObjectId: media?.id ?? null,
      processingStatus: media?.processingStatus ?? 'NONE',
      rejectionReason: media?.rejectionReason ?? null,
      uploadExpiresAt: media?.uploadExpiresAt ?? null,
      logo: this.view(media),
      tenantVersion: tenant.version,
    };
  }

  async remove(tenantId: string, actorUserId: string, expectedVersion: number) {
    const tenant = await this.loadTenant(tenantId);
    const updated = await this.prisma.tenant.updateMany({
      where: { id: tenantId, version: expectedVersion },
      data: { logoMediaId: null, version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw new ConflictException('Restaurant branding changed; refresh and retry');
    if (tenant.logoMediaId) {
      await this.prisma.mediaObject.updateMany({
        where: { id: tenant.logoMediaId, tenantId },
        data: { cleanupAfter: new Date(Date.now() + 7 * 86_400_000) },
      });
    }
    await this.audit.log({
      actorUserId,
      tenantId,
      action: 'BRANDING_LOGO_REMOVE',
      entityType: 'Tenant',
      entityId: tenantId,
      before: { logoMediaId: tenant.logoMediaId },
    });
    return { success: true, tenantVersion: expectedVersion + 1 };
  }
}
