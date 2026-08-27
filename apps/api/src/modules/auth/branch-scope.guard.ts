// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { type CanActivate, type ExecutionContext, Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TenantRole } from '@rms/contracts';
import { BRANCH_SCOPED_KEY, type TenantContext } from './types';

@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isBranchScoped = this.reflector.getAllAndOverride<boolean>(BRANCH_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isBranchScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ctx = request.tenantContext as TenantContext | undefined;

    if (!ctx || !ctx.tenantId) {
      throw new ForbiddenException('No tenant context');
    }

    // Super Admin bypass only for platform endpoints (no tenant scope)
    if (ctx.platformRole === 'SUPER_ADMIN' && !ctx.tenantId) {
      return true;
    }

    // Support sessions bypass branch assignment checks
    if (ctx.isSupportSession) {
      return true;
    }

    const branchId = (request.params as Record<string, string>).branchId;
    if (!branchId) {
      throw new ForbiddenException('Branch ID required');
    }

    // Owner sees all branches in tenant
    if (ctx.tenantRole === TenantRole.OWNER) {
      return true;
    }

    // Manager/Cashier/Kitchen must be assigned to this branch
    if (!ctx.branchIds || !ctx.branchIds.includes(branchId)) {
      throw new ForbiddenException('You are not assigned to this branch');
    }

    return true;
  }
}
