import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedSocket } from './ws-jwt.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';

export const KDS_ROOM_ROLES: Record<string, string[]> = {
  handleJoinBranch: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF', 'WAITER'],
  handleJoinStation: ['OWNER', 'MANAGER', 'KITCHEN_STAFF'],
  handleJoinExpo: ['OWNER', 'MANAGER', 'KITCHEN_STAFF'],
  handleJoinService: ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'],
  handleJoinWaiter: ['OWNER', 'MANAGER', 'WAITER'],
};

/**
 * WebSocket guard that authorizes room joins.
 * Must be used AFTER WsJwtAdapter has authenticated the socket.
 *
 * Verifies:
 * - Socket is authenticated
 * - KDS entitlement is effective for the tenant+branch
 * - Requested branchId is in the user's assigned branches
 * - No cross-tenant or cross-branch access
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureResolver) private readonly features: FeatureResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const data = context.switchToWs().getData() as Record<string, unknown> | undefined;

    // 1. Socket must be authenticated
    if (!client.data?.tenantContext) {
      this.logger.warn(`Unauthenticated socket room join attempt: ${client.id}`);
      return false;
    }

    const ctx = client.data.tenantContext;
    if (client.data.tokenExpiresAt && client.data.tokenExpiresAt.getTime() <= Date.now()) return false;

    // 2. Must have tenant context for KDS (no platform-only access)
    if (!ctx.tenantId || !ctx.userId) {
      this.logger.warn(`Socket ${client.id} has no tenant context`);
      return false;
    }

    // Leaving a room cannot grant access. All joins require a concrete branch.
    if (context.getHandler().name === 'handleLeave') return true;
    const branchId = data?.branchId;
    if (typeof branchId !== 'string' || !branchId) return false;

    // Never trust cached role/assignment claims from a long-lived connection.
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, status: 'ACTIVE',
        tenant: { status: 'ACTIVE' }, user: { status: 'ACTIVE' } },
      select: { role: true, branchAssignments: {
        where: { tenantId: ctx.tenantId, branchId, branch: { isActive: true, tenantId: ctx.tenantId } },
        select: { branchId: true },
      } },
    });
    if (!membership) return false;
    if (!KDS_ROOM_ROLES[context.getHandler().name]?.includes(membership.role)) return false;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId: ctx.tenantId, isActive: true }, select: { id: true },
    });
    if (!branch) return false;
    if (membership.role !== 'OWNER' && membership.branchAssignments.length === 0) return false;

    const entitlement = await this.features.resolve(ctx.tenantId, FeatureKey.KDS, branchId);
    if (!entitlement.effective) return false;
    if (context.getHandler().name === 'handleJoinStation' || data?.stationId !== undefined) {
      const stationId = data?.stationId;
      if (typeof stationId !== 'string' || !stationId) return false;
      const station = await this.prisma.kitchenStation.findFirst({
        where: { id: stationId, tenantId: ctx.tenantId, branchId, isActive: true,
          kitchen: { tenantId: ctx.tenantId, branchId, isActive: true } }, select: { id: true },
      });
      if (!station) return false;
    }
    ctx.tenantRole = membership.role as typeof ctx.tenantRole;

    return true;
  }
}
