import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const SUPPORT_SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes
export const SUPPORT_ALLOWED_PATH_PREFIXES = [
  '/api/v1/categories',
  '/api/v1/items',
  '/api/v1/variants',
  '/api/v1/modifier-groups',
  '/api/v1/modifiers',
  '/api/v1/branch-menu',
];

export interface SupportSessionData {
  id: string;
  adminUserId: string;
  tenantId: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  status: string;
  createdAt: Date;
}

@Injectable()
export class SupportContextService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async enterSupport(params: {
    adminUserId: string;
    tenantId: string;
    reason: string;
  }): Promise<SupportSessionData> {
    const { adminUserId, tenantId, reason } = params;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reason is required to enter support mode');
    }
    if (reason.length > 500) {
      throw new BadRequestException('Reason must be 500 characters or less');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: adminUserId } });
    if (!user || user.platformRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only Super Admin can enter support mode');
    }

    // Expire any existing stale ACTIVE sessions for this admin+tenant
    await this.prisma.supportSession.updateMany({
      where: {
        adminUserId,
        tenantId,
        status: 'ACTIVE',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED', endedAt: new Date() },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUPPORT_SESSION_DURATION_MS);

    const session = await this.prisma.$transaction(async (tx) => {
      // End any remaining ACTIVE session for this admin+tenant
      await tx.supportSession.updateMany({
        where: { adminUserId, tenantId, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now },
      });

      const created = await tx.supportSession.create({
        data: {
          adminUserId,
          tenantId,
          reason: reason.trim(),
          startedAt: now,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          tenantId,
          action: 'SUPPORT_SESSION_ENTER',
          entityType: 'SupportSession',
          entityId: created.id,
          afterJson: {
            reason: reason.trim(),
            expiresAt: expiresAt.toISOString(),
            duration: SUPPORT_SESSION_DURATION_MS,
          },
        },
      });

      return created;
    });

    return this.serializeSession(session);
  }

  async exitSupport(params: {
    adminUserId: string;
    tenantId: string;
  }): Promise<SupportSessionData> {
    const { adminUserId, tenantId } = params;

    const session = await this.prisma.supportSession.findFirst({
      where: { adminUserId, tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      throw new NotFoundException('No active support session found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.supportSession.update({
        where: { id: session.id },
        data: { status: 'ENDED', endedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          tenantId,
          action: 'SUPPORT_SESSION_EXIT',
          entityType: 'SupportSession',
          entityId: session.id,
          beforeJson: { status: 'ACTIVE' },
          afterJson: { status: 'ENDED' },
        },
      });

      return result;
    });

    return this.serializeSession(updated);
  }

  async getActiveSession(params: {
    adminUserId: string;
    tenantId: string;
  }): Promise<SupportSessionData | null> {
    const { adminUserId, tenantId } = params;

    const session = await this.prisma.supportSession.findFirst({
      where: { adminUserId, tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) return null;

    if (session.expiresAt <= new Date()) {
      await this.prisma.supportSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED', endedAt: new Date() },
      });
      return null;
    }

    return this.serializeSession(session);
  }

  isPathAllowed(path: string): boolean {
    return SUPPORT_ALLOWED_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
  }

  async expireStaleSessions(): Promise<number> {
    const result = await this.prisma.supportSession.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', endedAt: new Date() },
    });
    return result.count;
  }

  private serializeSession(session: {
    id: string;
    adminUserId: string;
    tenantId: string;
    reason: string;
    startedAt: Date;
    expiresAt: Date;
    endedAt: Date | null;
    status: string;
    createdAt: Date;
  }): SupportSessionData {
    return {
      id: session.id,
      adminUserId: session.adminUserId,
      tenantId: session.tenantId,
      reason: session.reason,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      status: session.status,
      createdAt: session.createdAt,
    };
  }
}
