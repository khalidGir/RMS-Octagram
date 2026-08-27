import { Inject, type NestMiddleware} from '@nestjs/common';
import { Injectable, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- JwtService is used as constructor value for NestJS DI
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- PrismaService is used as constructor value for NestJS DI
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import type { TenantContext } from '../auth/types';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      req.tenantContext = undefined;
      return next();
    }

    try {
      const token = authHeader.slice(7);
      const payload = this.jwtService.verify<JwtPayload>(token);

      const ctx: TenantContext = {
        userId: payload.sub,
        email: payload.email,
        platformRole: payload.platformRole,
      };

      // Resolve tenant from x-tenant-id header
      const tenantId = req.headers['x-tenant-id'] as string;

      if (tenantId) {
        // Verify tenant is active
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, status: true },
        });

        if (!tenant) {
          throw new ForbiddenException('Tenant not found');
        }

        if (tenant.status !== 'ACTIVE') {
          throw new ForbiddenException('Tenant is not active');
        }

        // Verify membership exists and is active
        const membership = await this.prisma.tenantMembership.findUnique({
          where: {
            tenantId_userId: { tenantId, userId: payload.sub },
          },
          select: {
            role: true,
            status: true,
            branchAssignments: {
              select: {
                branchId: true,
                branch: {
                  select: { id: true, isActive: true },
                },
              },
            },
          },
        });

        if (!membership) {
          // Super Admins may access tenants via support sessions (no membership required)
          if (payload.platformRole === 'SUPER_ADMIN') {
            const supportSession = await this.prisma.supportSession.findFirst({
              where: {
                adminUserId: payload.sub,
                tenantId,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() },
              },
              orderBy: { createdAt: 'desc' },
            });

            if (supportSession) {
              ctx.tenantId = tenantId;
              ctx.tenantRole = 'SUPPORT' as TenantContext['tenantRole'];
              ctx.branchIds = [];
              ctx.isSupportSession = true;
              req.tenantContext = ctx;
              return next();
            }
          }

          throw new ForbiddenException('Not a member of this tenant');
        }

        if (membership.status !== 'ACTIVE') {
          throw new ForbiddenException('Membership is not active');
        }

        // Filter to active branches only
        const activeBranchIds = membership.branchAssignments
          .filter((a) => a.branch.isActive)
          .map((a) => a.branchId);

        ctx.tenantId = tenantId;
        ctx.tenantRole = membership.role as TenantContext['tenantRole'];
        ctx.branchIds = activeBranchIds;
      }

      req.tenantContext = ctx;
    } catch (error) {
      // Re-throw ForbiddenException, swallow JWT errors
      if (error instanceof ForbiddenException) {
        throw error;
      }
      req.tenantContext = undefined;
    }

    next();
  }
}
