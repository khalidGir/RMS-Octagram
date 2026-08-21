import { Injectable, Inject, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import { PlatformRole } from '@rms/contracts';

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    // Validate role is a valid platform role
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
    // Revoke all sessions first, then deactivate
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
}
