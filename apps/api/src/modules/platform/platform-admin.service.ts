import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { PlatformRole, FeatureKey, EntitlementStatus } from '@rms/contracts';
import { getAllFeatureKeys } from '../features/feature-catalog';

function getValidStatuses(): string[] {
  return Object.values(EntitlementStatus);
}

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async listTenants(filters?: { status?: string }) {
    const where = filters?.status ? { status: filters.status } : {};
    return this.prisma.tenant.findMany({
      where,
      include: {
        _count: { select: { branches: true, memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async suspendTenant(tenantId: string) {
    this.logger.warn(`Tenant suspended: ${tenantId}`);
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'SUSPENDED' },
    });
  }

  async activateTenant(tenantId: string) {
    this.logger.log(`Tenant activated: ${tenantId}`);
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
    });
  }

  async listUsers(tenantId?: string) {
    if (tenantId) {
      return this.prisma.user.findMany({
        where: {
          memberships: { some: { tenantId } },
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          platformRole: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        platformRole: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setUserPlatformRole(userId: string, role: string) {
    const validRoles = Object.values(PlatformRole);
    if (!validRoles.includes(role as PlatformRole)) {
      throw new Error(`Invalid platform role: ${role}. Valid roles: ${validRoles.join(', ')}`);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { platformRole: role as any },
    });
  }

  async deactivateUser(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.warn(`User deactivated and sessions revoked: ${userId}`);

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'DELETED' },
    });
  }

  // ─── ENTITLEMENTS ──────────────────────────

  async listEntitlements(tenantId: string) {
    await this.assertTenantExists(tenantId);

    const entitlements = await this.prisma.tenantEntitlement.findMany({
      where: { tenantId },
      orderBy: { featureKey: 'asc' },
    });

    // Merge with catalog to show all features
    const entitlementMap = new Map(entitlements.map((e) => [e.featureKey, e]));
    const allKeys = getAllFeatureKeys();

    return allKeys.map((key) => {
      const ent = entitlementMap.get(key);
      return {
        featureKey: key,
        status: ent?.status ?? EntitlementStatus.DISABLED,
        trialEndsAt: ent?.trialEndsAt ?? null,
        reason: ent?.reason ?? null,
        internalNote: ent?.internalNote ?? null,
        updatedAt: ent?.updatedAt ?? null,
      };
    });
  }

  async setEntitlement(params: {
    tenantId: string;
    featureKey: FeatureKey;
    status: EntitlementStatus;
    trialEndsAt?: string;
    reason?: string;
    internalNote?: string;
    actorUserId: string;
  }) {
    const { tenantId, featureKey, status, trialEndsAt, reason, internalNote, actorUserId } = params;

    await this.assertTenantExists(tenantId);

    if (!getValidStatuses().includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}. Must be one of: ${getValidStatuses().join(', ')}`);
    }

    // Validate trial expiry
    if (status === EntitlementStatus.TRIAL) {
      if (!trialEndsAt) {
        throw new BadRequestException('trialEndsAt is required when status is TRIAL');
      }
      const expiryDate = new Date(trialEndsAt);
      if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
        throw new BadRequestException('trialEndsAt must be a valid future date');
      }
    }

    // Get existing for audit
    const existing = await this.prisma.tenantEntitlement.findUnique({
      where: { tenantId_featureKey: { tenantId, featureKey } },
    });

    // Upsert with transaction + audit
    const result = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.tenantEntitlement.upsert({
        where: { tenantId_featureKey: { tenantId, featureKey } },
        create: {
          tenantId,
          featureKey,
          status,
          trialEndsAt: status === EntitlementStatus.TRIAL ? new Date(trialEndsAt!) : null,
          updatedByUserId: actorUserId,
          reason: reason ?? null,
          internalNote: internalNote ?? null,
        },
        update: {
          status,
          trialEndsAt: status === EntitlementStatus.TRIAL ? new Date(trialEndsAt!) : null,
          updatedByUserId: actorUserId,
          reason: reason ?? null,
          internalNote: internalNote ?? null,
        },
      });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          action: 'ENTITLEMENT_UPDATE',
          entityType: 'TenantEntitlement',
          entityId: upserted.id,
          beforeJson: existing
            ? { status: existing.status, trialEndsAt: existing.trialEndsAt } as any
            : undefined,
          afterJson: { status, trialEndsAt: status === EntitlementStatus.TRIAL ? trialEndsAt : null } as any,
        },
      });

      return upserted;
    });

    return result;
  }

  async getEffectiveFeatures(tenantId: string, branchId?: string) {
    await this.assertTenantExists(tenantId);
    return this.featureResolver.resolveAll(tenantId, branchId);
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
  }
}
