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
 * This guard should be applied globally or to non-catalog controllers.
 */
@Injectable()
export class SupportModeGuard implements CanActivate {
  constructor(
    @Inject(SupportContextService) private readonly supportContextService: SupportContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = req.tenantContext as TenantContext;

    // Only applies to Super Admin users
    if (ctx?.platformRole !== 'SUPER_ADMIN') {
      return true;
    }

    // If no tenant context, this is a platform-level endpoint — allow
    if (!ctx?.tenantId) {
      return true;
    }

    // Check if there's an active support session
    const session = await this.supportContextService.getActiveSession({
      adminUserId: ctx.userId,
      tenantId: ctx.tenantId,
    });

    // If no active session, this Super Admin doesn't have support access to this tenant
    if (!session) {
      throw new ForbiddenException(
        'Super Admin requires an active support session to access tenant data. ' +
        'Enter support mode via POST /platform/support/enter.',
      );
    }

    // Check if the request path is allowed (menu/catalog endpoints only)
    const path = req.path;
    if (!this.supportContextService.isPathAllowed(path)) {
      throw new ForbiddenException(
        `Support mode only allows menu/catalog operations. Path "${path}" is not permitted. ` +
        `Allowed prefixes: ${'/api/v1/categories, /api/v1/items, /api/v1/variants, /api/v1/modifier-groups, /api/v1/modifiers, /api/v1/branch-menu'}`,
      );
    }

    return true;
  }
}
