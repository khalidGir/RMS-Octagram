import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { PlatformRole, EntitlementStatus, maskEthiopianPhone } from '@rms/contracts';
import type { FeatureKey } from '@rms/contracts';
import { getAllFeatureKeys } from '../features/feature-catalog';

function getValidStatuses(): string[] {
  return Object.values(EntitlementStatus);
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(TenancyService) private readonly tenancyService: TenancyService,
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

  async getTenantDetail(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: { select: { branches: true, memberships: true } },
        branches: {
          select: {
            id: true,
            name: true,
            slug: true,
            publicSlug: true,
            timezone: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        memberships: {
          select: {
            role: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                displayName: true,
                phoneE164: true,
                email: true,
                status: true,
                lastLoginAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
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

  async createTenant(
    data: {
      name: string;
      slug?: string;
      ownerPhone: string;
      ownerPassword: string;
      ownerName?: string;
    },
    actorUserId: string,
  ) {
    const name = data.name.trim();
    const slug = await this.resolveTenantSlug(data.slug, name);

    const digits = data.ownerPhone.replace(/\D/g, '');
    const ownerName = data.ownerName?.trim() || `Owner ${digits.slice(-4)}`;

    const result = await this.tenancyService.createTenant({
      name,
      slug,
      ownerPhone: data.ownerPhone,
      ownerPassword: data.ownerPassword,
      ownerName,
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId: result.tenant.id,
        action: 'PLATFORM_TENANT_CREATE',
        entityType: 'Tenant',
        entityId: result.tenant.id,
        afterJson: {
          name: result.tenant.name,
          slug: result.tenant.slug,
          ownerPhone: maskEthiopianPhone(result.owner.phoneE164 ?? data.ownerPhone),
        },
      },
    });

    this.logger.log(`Tenant provisioned: ${result.tenant.id} (${result.tenant.slug})`);

    return {
      tenant: result.tenant,
      owner: {
        id: result.owner.id,
        phoneE164: result.owner.phoneE164,
        displayName: result.owner.displayName,
      },
    };
  }

  private async resolveTenantSlug(provided: string | undefined, name: string): Promise<string> {
    const base = provided ? slugify(provided) : slugify(name);
    if (!base) {
      throw new BadRequestException(
        provided ? 'Slug must contain letters or numbers' : 'Could not derive a slug from the tenant name',
      );
    }

    if (provided) {
      const existing = await this.prisma.tenant.findUnique({
        where: { slug: base },
        select: { id: true },
      });
      if (existing) throw new ConflictException('Tenant slug already exists');
      return base;
    }

    for (let i = 1; i <= 50; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const existing = await this.prisma.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    return `${base}-${Date.now()}`;
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
          phoneE164: true,
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
        phoneE164: true,
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
