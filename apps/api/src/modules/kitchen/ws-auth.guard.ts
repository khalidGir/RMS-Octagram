import { Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedSocket } from './ws-jwt.adapter';

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

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const data = context.switchToWs().getData() as Record<string, unknown> | undefined;

    // 1. Socket must be authenticated
    if (!client.data?.tenantContext) {
      this.logger.warn(`Unauthenticated socket room join attempt: ${client.id}`);
      return false;
    }

    const ctx = client.data.tenantContext;

    // 2. Must have tenant context for KDS (no platform-only access)
    if (!ctx.tenantId) {
      this.logger.warn(`Socket ${client.id} has no tenant context`);
      return false;
    }

    // 3. KDS entitlement must be effective
    if (client.data.kdsEffective === false) {
      this.logger.warn(
        `Socket ${client.id} denied: KDS not effective for tenant ${ctx.tenantId}`,
      );
      return false;
    }

    // 4. Validate branchId from the message data
    const branchId = data?.branchId as string | undefined;
    if (branchId && ctx.branchIds) {
      // OWNER role bypasses branch check (same as BranchScopeGuard)
      if (ctx.tenantRole !== 'OWNER' && !ctx.branchIds.includes(branchId)) {
        this.logger.warn(
          `Socket ${client.id} denied: branch ${branchId} not in assigned branches [${ctx.branchIds.join(',')}]`,
        );
        return false;
      }
    }

    return true;
  }
}
