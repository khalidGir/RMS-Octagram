import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../auth/types';
import { SupportContextService } from './support-context.service';

/**
 * Guard that enforces menu-only access for Super Admin support sessions.
 *
 * When a Super Admin is in support mode for a tenant, only catalog/menu
 * endpoints are allowed. All other endpoints return 403.
 *
 * This guard is applied globally. It only activates when:
 * 1. The user is a Super Admin
 * 2. The request has a tenant context (x-tenant-id header)
 * 3. The tenant context was established via a support session (isSupportSession=true)
 *
 * Normal membership-based access for Super Admins is unaffected.
 */
@Injectable()
export class SupportModeGuard implements CanActivate {
  constructor(
    @Inject(SupportContextService) private readonly supportContextService: SupportContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = req.tenantContext as TenantContext | undefined;

    // No tenant context — platform-level endpoint, allow
    if (!ctx?.tenantId) {
      return true;
    }

    // Not a Super Admin — normal RBAC handles this
    if (ctx.platformRole !== 'SUPER_ADMIN') {
      return true;
    }

    // Not a support session — this Super Admin has normal membership access
    if (!ctx.isSupportSession) {
      return true;
    }

    // Support session active — only catalog/menu paths are allowed
    const path = req.path;
    if (!this.supportContextService.isPathAllowed(path)) {
      throw new ForbiddenException(
        `Support mode only allows menu/catalog operations. Path "${path}" is not permitted.`,
      );
    }

    return true;
  }
}
