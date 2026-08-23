import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { createHash } from 'crypto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from '../auth/auth.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
import { TenantRole, FeatureKey } from '@rms/contracts';
import { getAllFeatureKeys, DEFAULT_NEW_TENANT_FEATURES } from '../features/feature-catalog';

/** Role hierarchy: who can grant what */
const GRANTABLE_BY_ROLE: Record<string, TenantRole[]> = {
  [TenantRole.OWNER]: [
    TenantRole.OWNER,
    TenantRole.MANAGER,
    TenantRole.CASHIER,
    TenantRole.KITCHEN_STAFF,
  ],
  [TenantRole.MANAGER]: [
    TenantRole.CASHIER,
    TenantRole.KITCHEN_STAFF,
  ],
};

/** Roles a Manager can modify (target's current role must be in this list) */
const MANAGEABLE_BY_MANAGER: TenantRole[] = [
  TenantRole.CASHIER,
  TenantRole.KITCHEN_STAFF,
];

@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  /**
   * Enforce the rule that a caller can only modify targets of appropriate roles.
   * Owner can modify anyone. Manager can only modify CASHIER/KITCHEN_STAFF.
   */
  private assertTargetRoleAllowed(callerRole: string, targetRole: string): void {
    if (callerRole === TenantRole.OWNER) return; // Owners can modify anyone

    if (callerRole === TenantRole.MANAGER) {
      if (!MANAGEABLE_BY_MANAGER.includes(targetRole as TenantRole)) {
        throw new ForbiddenException(
          `Managers cannot modify ${targetRole} members. Only CASHIER/KITCHEN_STAFF.`,
        );
      }
      return;
    }

    throw new ForbiddenException(`Role ${callerRole} cannot modify memberships`);
  }

  async createTenant(data: {
    name: string;
    slug: string;
    ownerEmail: string;
    ownerPassword: string;
    ownerName: string;
  }) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new ConflictException('Tenant slug already exists');
    }

    const passwordHash = await this.authService.hashPassword(data.ownerPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: data.name, slug: data.slug, status: 'ACTIVE' },
      });

      const owner = await tx.user.create({
        data: {
          email: data.ownerEmail,
          passwordHash,
          displayName: data.ownerName,
          status: 'ACTIVE',
        },
      });

      const membership = await tx.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      // Seed default entitlements for new tenant
      const allKeys = getAllFeatureKeys();
      const defaultKeys = DEFAULT_NEW_TENANT_FEATURES;

      for (const key of allKeys) {
        await tx.tenantEntitlement.create({
          data: {
            tenantId: tenant.id,
            featureKey: key,
            status: defaultKeys.includes(key) ? 'ENABLED' : 'DISABLED',
          },
        });
      }

      // Seed tenant-level feature settings (enabled for default features)
      for (const key of defaultKeys) {
        await tx.featureSetting.create({
          data: {
            tenantId: tenant.id,
            branchId: null,
            featureKey: key,
            enabled: true,
            updatedByUserId: owner.id,
          },
        });
      }

      this.logger.log(`Tenant created: ${tenant.id} (${tenant.slug}), owner: ${owner.id}`);
      return { tenant, owner, membership };
    });

    return result;
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateTenant(tenantId: string, data: { name?: string; status?: string }) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data });
  }

  async listBranches(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createBranch(tenantId: string, data: { name: string; slug: string }) {
    // Service-level MULTI_BRANCH feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.MULTI_BRANCH);

    const existing = await this.prisma.branch.findFirst({
      where: { tenantId, slug: data.slug },
    });
    if (existing) {
      throw new ConflictException('Branch slug already exists in this tenant');
    }

    return this.prisma.branch.create({
      data: { tenantId, name: data.name, slug: data.slug },
    });
  }

  async updateBranch(
    branchId: string,
    tenantId: string,
    data: { name?: string; isActive?: boolean },
    callerRole?: string,
    callerBranchIds?: string[],
  ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    // Managers can only update branches they are assigned to
    if (callerRole === TenantRole.MANAGER && callerBranchIds && !callerBranchIds.includes(branchId)) {
      throw new ForbiddenException('You are not assigned to this branch');
    }

    return this.prisma.branch.update({ where: { id: branchId }, data });
  }

  async listMemberships(tenantId: string) {
    return this.prisma.tenantMembership.findMany({
      where: { tenantId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        branchAssignments: {
          include: { branch: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
  }

  /**
   * Update membership with full authorization:
   * - Tenant-scoped lookup
   * - Cannot modify self
   * - Target-role hierarchy enforced
   * - Role grant hierarchy enforced
   */
  async updateMembership(
    membershipId: string,
    tenantId: string,
    callerUserId: string,
    callerRole: string,
    data: { role?: TenantRole; status?: string },
  ) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found in this tenant');
    }

    // Cannot modify your own membership
    if (membership.userId === callerUserId) {
      throw new ForbiddenException('Cannot modify your own membership');
    }

    // Target-role check: can only modify members of appropriate roles
    this.assertTargetRoleAllowed(callerRole, membership.role);

    // If changing role, enforce grant hierarchy
    if (data.role) {
      const grantable = GRANTABLE_BY_ROLE[callerRole] || [];
      if (!grantable.includes(data.role)) {
        throw new ForbiddenException(
          `Your role (${callerRole}) cannot grant ${data.role}. Grantable: ${grantable.join(', ')}`,
        );
      }
    }

    const before = { role: membership.role, status: membership.status };
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data,
    });

    await this.audit.log({
      actorUserId: callerUserId,
      tenantId,
      action: 'MEMBERSHIP_UPDATE',
      entityType: 'TenantMembership',
      entityId: membershipId,
      before,
      after: data,
    });

    return updated;
  }

  /**
   * Replace branch assignments transactionally.
   * - Validates membership and all branches belong to tenant
   * - Target-role hierarchy enforced
   * - Managers limited to their own assigned branches
   */
  async replaceBranchAssignments(
    membershipId: string,
    tenantId: string,
    branchIds: string[],
    callerUserId: string,
    callerRole?: string,
    callerBranchIds?: string[],
  ) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found in this tenant');
    }

    // Target-role check
    this.assertTargetRoleAllowed(callerRole!, membership.role);

    // Validate all branches belong to tenant
    const validBranches = await this.prisma.branch.findMany({
      where: { tenantId, id: { in: branchIds } },
      select: { id: true },
    });

    if (validBranches.length !== branchIds.length) {
      const validIds = new Set(validBranches.map((b) => b.id));
      const invalid = branchIds.filter((id) => !validIds.has(id));
      throw new BadRequestException(`Branches not found in this tenant: ${invalid.join(', ')}`);
    }

    // Managers limited to their own branches
    if (callerRole === TenantRole.MANAGER && callerBranchIds) {
      const unauthorized = branchIds.filter((id) => !callerBranchIds.includes(id));
      if (unauthorized.length > 0) {
        throw new ForbiddenException(`You are not assigned to branches: ${unauthorized.join(', ')}`);
      }
    }

    const before = await this.prisma.branchAssignment.findMany({
      where: { membershipId },
      select: { branchId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.branchAssignment.deleteMany({ where: { membershipId } });

      if (branchIds.length > 0) {
        await tx.branchAssignment.createMany({
          data: branchIds.map((branchId) => ({
            tenantId,
            branchId,
            membershipId,
          })),
        });
      }
    });

    await this.audit.log({
      actorUserId: callerUserId,
      tenantId,
      action: 'BRANCH_ASSIGNMENTS_REPLACE',
      entityType: 'TenantMembership',
      entityId: membershipId,
      before: { branchIds: before.map((b) => b.branchId) },
      after: { branchIds },
    });
  }

  /**
   * Create invitation transactionally:
   * - Enforces grant hierarchy
   * - Validates branches
   * - Creates user if needed, membership as INVITED, branch assignments
   * - Hashes and persists invitation token with expiry
   */
  async inviteMember(
    tenantId: string,
    data: {
      email: string;
      role: TenantRole;
      branchIds?: string[];
      invitedByUserId: string;
      callerRole: string;
      callerBranchIds?: string[];
    },
  ) {
    // Grant hierarchy
    const grantable = GRANTABLE_BY_ROLE[data.callerRole] || [];
    if (!grantable.includes(data.role)) {
      throw new ForbiddenException(
        `Your role (${data.callerRole}) cannot invite as ${data.role}. Grantable: ${grantable.join(', ')}`,
      );
    }

    // Validate branches
    if (data.branchIds && data.branchIds.length > 0) {
      const validBranches = await this.prisma.branch.findMany({
        where: { tenantId, id: { in: data.branchIds } },
        select: { id: true },
      });

      if (validBranches.length !== data.branchIds.length) {
        const validIds = new Set(validBranches.map((b) => b.id));
        const invalid = data.branchIds.filter((id) => !validIds.has(id));
        throw new BadRequestException(`Branches not found in this tenant: ${invalid.join(', ')}`);
      }

      // Managers limited to their own branches
      if (data.callerRole === TenantRole.MANAGER && data.callerBranchIds) {
        const unauthorized = data.branchIds.filter((id) => !data.callerBranchIds!.includes(id));
        if (unauthorized.length > 0) {
          throw new ForbiddenException(`You are not assigned to branches: ${unauthorized.join(', ')}`);
        }
      }
    }

    // Generate invitation token
    const invitationToken = randomBytes(32).toString('hex');
    const invitationTokenHash = createHash('sha256').update(invitationToken).digest('hex');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create user
      let user = await tx.user.findFirst({ where: { email: data.email } });

      if (!user) {
        const tempPassword = randomBytes(16).toString('hex');
        const passwordHash = await this.authService.hashPassword(tempPassword);

        user = await tx.user.create({
          data: {
            email: data.email,
            passwordHash,
            displayName: data.email.split('@')[0],
            status: 'ACTIVE',
          },
        });
      }

      // Check for existing membership
      const existing = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
      });

      if (existing) {
        throw new ConflictException('User is already a member of this tenant');
      }

      // Create membership with invitation token
      const membership = await tx.tenantMembership.create({
        data: {
          tenantId,
          userId: user.id,
          role: data.role,
          status: 'INVITED',
          invitedByUserId: data.invitedByUserId,
          invitationTokenHash,
          invitationExpiresAt,
        },
      });

      // Create branch assignments
      if (data.branchIds && data.branchIds.length > 0) {
        await tx.branchAssignment.createMany({
          data: data.branchIds.map((branchId) => ({
            tenantId,
            branchId,
            membershipId: membership.id,
          })),
        });
      }

      return { membershipId: membership.id, userId: user.id };
    });

    await this.audit.log({
      actorUserId: data.invitedByUserId,
      tenantId,
      action: 'MEMBERSHIP_INVITE',
      entityType: 'TenantMembership',
      entityId: result.membershipId,
      after: { email: data.email, role: data.role, branchIds: data.branchIds },
    });

    return {
      membershipId: result.membershipId,
      invitationToken,
      invitationExpiresAt,
    };
  }

  /**
   * Accept invitation: validates token, marks membership ACTIVE, sets acceptedAt.
   */
  async acceptInvitation(invitationToken: string, userId: string) {
    const tokenHash = createHash('sha256').update(invitationToken).digest('hex');

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        invitationTokenHash: tokenHash,
        status: 'INVITED',
      },
    });

    if (!membership) {
      throw new NotFoundException('Invalid or already used invitation');
    }

    if (membership.invitationExpiresAt && membership.invitationExpiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    if (membership.userId !== userId) {
      throw new ForbiddenException('This invitation is for a different user');
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: {
        status: 'ACTIVE',
        acceptedAt: new Date(),
        invitationTokenHash: null, // Single-use: clear after acceptance
      },
    });

    await this.audit.log({
      actorUserId: userId,
      tenantId: membership.tenantId,
      action: 'MEMBERSHIP_INVITATION_ACCEPTED',
      entityType: 'TenantMembership',
      entityId: membership.id,
    });

    return updated;
  }

  /**
   * Update membership status with full authorization.
   */
  async updateMembershipStatus(
    membershipId: string,
    tenantId: string,
    callerUserId: string,
    callerRole: string,
    status: string,
  ) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found in this tenant');
    }

    // Cannot modify yourself
    if (membership.userId === callerUserId) {
      throw new ForbiddenException('Cannot modify your own membership');
    }

    // Target-role check
    this.assertTargetRoleAllowed(callerRole, membership.role);

    const before = { status: membership.status };
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data: { status },
    });

    await this.audit.log({
      actorUserId: callerUserId,
      tenantId,
      action: `MEMBERSHIP_STATUS_${status.toUpperCase()}`,
      entityType: 'TenantMembership',
      entityId: membershipId,
      before,
      after: { status },
    });

    return updated;
  }

  async getFeatures(tenantId: string, branchId?: string) {
    const tenantFeatures = await this.prisma.featureSetting.findMany({
      where: { tenantId, branchId: null },
    });

    let branchFeatures: any[] = [];
    if (branchId) {
      branchFeatures = await this.prisma.featureSetting.findMany({
        where: { tenantId, branchId },
      });
    }

    const merged = new Map<string, any>();
    for (const f of tenantFeatures) merged.set(f.featureKey, f);
    for (const f of branchFeatures) merged.set(f.featureKey, f);

    return Array.from(merged.values());
  }

  async setFeature(
    tenantId: string,
    branchId: string | null,
    featureKey: string,
    enabled: boolean,
    userId: string,
    callerRole?: string,
    callerBranchIds?: string[],
  ) {
    // Validate feature key
    const validKeys = getAllFeatureKeys();
    if (!validKeys.includes(featureKey as FeatureKey)) {
      throw new BadRequestException(`Invalid feature key: ${featureKey}. Valid keys: ${validKeys.join(', ')}`);
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
      });
      if (!branch) {
        throw new NotFoundException('Branch not found in this tenant');
      }

      if (callerRole === TenantRole.MANAGER && callerBranchIds && !callerBranchIds.includes(branchId)) {
        throw new ForbiddenException('You are not assigned to this branch');
      }
    } else {
      // Tenant-level setting: check platform entitlement gate
      const entitlement = await this.prisma.tenantEntitlement.findUnique({
        where: { tenantId_featureKey: { tenantId, featureKey } },
      });

      const platformStatus = entitlement?.status ?? 'DISABLED';
      const platformAllows =
        platformStatus === 'ENABLED' ||
        (platformStatus === 'TRIAL' && entitlement?.trialEndsAt && entitlement.trialEndsAt > new Date());

      if (!platformAllows && enabled) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'FEATURE_DISABLED',
          feature: featureKey,
          reason: platformStatus === 'TRIAL' ? 'TRIAL_EXPIRED' : platformStatus,
          message: `Cannot enable ${featureKey}: platform entitlement is ${platformStatus}.`,
        });
      }
    }

    const existing = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId, featureKey },
    });

    if (existing) {
      const updated = await this.prisma.featureSetting.update({
        where: { id: existing.id },
        data: { enabled, updatedByUserId: userId },
      });

      await this.audit.log({
        actorUserId: userId,
        tenantId,
        branchId: branchId ?? undefined,
        action: 'FEATURE_SETTING_UPDATE',
        entityType: 'FeatureSetting',
        entityId: existing.id,
        before: { enabled: existing.enabled },
        after: { enabled },
      });

      return updated;
    }

    const created = await this.prisma.featureSetting.create({
      data: { tenantId, branchId, featureKey, enabled, updatedByUserId: userId },
    });

    await this.audit.log({
      actorUserId: userId,
      tenantId,
      branchId: branchId ?? undefined,
      action: 'FEATURE_SETTING_UPDATE',
      entityType: 'FeatureSetting',
      entityId: created.id,
        after: { enabled },
    });

    return created;
  }

  // ─── TENANT-LEVEL FEATURES ─────────────────

  async getTenantFeatures(tenantId: string) {
    const allKeys = getAllFeatureKeys();
    const entitlements = await this.prisma.tenantEntitlement.findMany({
      where: { tenantId },
    });
    const entitlementMap = new Map(entitlements.map((e) => [e.featureKey, e]));

    const tenantSettings = await this.prisma.featureSetting.findMany({
      where: { tenantId, branchId: null },
    });
    const tenantSettingMap = new Map(tenantSettings.map((s) => [s.featureKey, s]));

    const result: Array<{
      featureKey: string;
      entitlementStatus: string;
      trialEndsAt: Date | null;
      tenantEnabled: boolean;
      effective: boolean;
    }> = [];

    for (const key of allKeys) {
      const entitlement = entitlementMap.get(key);
      const tenantSetting = tenantSettingMap.get(key);
      const effective = await this.featureResolver.resolve(tenantId, key as FeatureKey);

      result.push({
        featureKey: key,
        entitlementStatus: entitlement?.status ?? 'DISABLED',
        trialEndsAt: entitlement?.trialEndsAt ?? null,
        tenantEnabled: tenantSetting?.enabled ?? false,
        effective: effective.effective,
      });
    }

    return result;
  }

  async setTenantFeature(
    tenantId: string,
    featureKey: string,
    enabled: boolean,
    userId: string,
  ) {
    // Reuse setFeature with branchId=null (which also checks entitlement gate)
    return this.setFeature(tenantId, null, featureKey, enabled, userId);
  }
}
