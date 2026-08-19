import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { BRANCH_SCOPED_KEY, type TenantContext } from './types';
import { TenantRole, PlatformRole } from '@rms/contracts';

@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isBranchScoped = this.reflector.getAllAndOverride<boolean>(BRANCH_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isBranchScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ctx = request.tenantContext as TenantContext | undefined;

    if (!ctx) {
      throw new ForbiddenException('No tenant context');
    }

    // Platform admins only bypass for platform endpoints (no tenantId)
    if (ctx.platformRole === PlatformRole.SUPER_ADMIN && !ctx.tenantId) {
      return true;
    }

    // Owners have access to all branches in their tenant
    if (ctx.tenantRole === TenantRole.OWNER) {
      return true;
    }

    // Check branch assignment from route params
    const branchId = request.params?.branchId;
    if (branchId && ctx.branchIds && !ctx.branchIds.includes(branchId)) {
      throw new ForbiddenException('Access denied to this branch');
    }

    return true;
  }
}
