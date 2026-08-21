// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { type CanActivate, type ExecutionContext, Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type TenantContext } from './types';
import { TenantRole, PlatformRole } from '@rms/contracts';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<(TenantRole | PlatformRole)[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ctx = request.tenantContext as TenantContext | undefined;

    if (!ctx) {
      throw new ForbiddenException('No tenant context');
    }

    // Check if any required role is a platform role
    const platformRolesRequired = requiredRoles.filter(
      (r) => Object.values(PlatformRole).includes(r as PlatformRole),
    );

    if (platformRolesRequired.length > 0) {
      // Platform role check — only for platform endpoints (no tenantId)
      // Platform admins do NOT automatically bypass tenant-scoped role checks
      if (platformRolesRequired.includes(ctx.platformRole as PlatformRole)) {
        return true;
      }
      throw new ForbiddenException(
        `Required platform role: ${platformRolesRequired.join(' or ')}. Your role: ${ctx.platformRole}`,
      );
    }

    // Tenant role check
    const tenantRolesRequired = requiredRoles.filter(
      (r) => Object.values(TenantRole).includes(r as TenantRole),
    );

    if (tenantRolesRequired.length === 0) {
      return true;
    }

    // Must have a tenant context with a valid tenant role
    if (!ctx.tenantId || !ctx.tenantRole) {
      throw new ForbiddenException('Not a member of this tenant');
    }

    if (!tenantRolesRequired.includes(ctx.tenantRole as TenantRole)) {
      throw new ForbiddenException(
        `Required role: ${tenantRolesRequired.join(' or ')}. Your role: ${ctx.tenantRole}`,
      );
    }

    return true;
  }
}
