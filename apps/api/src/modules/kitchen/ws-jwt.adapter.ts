import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import type { JwtPayload } from '../auth/auth.service';
import type { TenantContext } from '../auth/types';
import type { Server, Socket } from 'socket.io';

export interface AuthenticatedSocket extends Socket {
  data: SocketData & Record<string, unknown>;
}

export interface SocketData {
  tenantContext?: TenantContext;
  kdsEffective?: boolean;
  authenticatedAt?: Date;
}

/**
 * Custom Socket.IO adapter that authenticates connections via JWT.
 * Reuses the same validation logic as the HTTP TenantContextMiddleware:
 * - JWT signature + expiration verification
 * - Active user check
 * - Active tenant membership check
 * - Active branch assignment check
 * - KDS entitlement check
 *
 * Does NOT accept tenant or branch identity from the client without server verification.
 */
export class WsJwtAdapter extends IoAdapter {
  private readonly logger = new Logger(WsJwtAdapter.name);
  private jwtService!: JwtService;
  private prisma!: PrismaService;
  private featureResolver!: FeatureResolver;
  private configService!: ConfigService;
  private initialized = false;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  private initServices() {
    if (this.initialized) return;
    this.jwtService = this.app.get(JwtService);
    this.prisma = this.app.get(PrismaService);
    this.featureResolver = this.app.get(FeatureResolver);
    this.configService = this.app.get(ConfigService);
    this.initialized = true;
  }

  createIOServer(port: number, options?: Record<string, unknown>): Server {
    this.initServices();

    const corsOrigin = this.configService.get<string>('API_CORS_ORIGIN', 'http://localhost:3000');
    const allowedOrigins = corsOrigin.split(',').map((o) => o.trim());

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          const allowed = allowedOrigins.some((o) => {
            try {
              const allowedUrl = new URL(o);
              const originUrl = new URL(origin);
              return originUrl.hostname === allowedUrl.hostname ||
                originUrl.hostname.endsWith('.' + allowedUrl.hostname);
            } catch {
              return origin === o;
            }
          });
          callback(null, allowed);
        },
        credentials: true,
      },
      namespace: '/kds',
      connectTimeout: 10000,
    });

    server.use(async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        await this.authenticateSocket(socket);
        next();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        this.logger.warn(`Socket auth rejected: ${message} [${socket.id}]`);
        next(new Error(message));
      }
    });

    return server;
  }

  /**
   * Full authentication pipeline — mirrors the HTTP TenantContextMiddleware + JwtStrategy.
   * Rejects expired/invalid tokens, inactive users, inactive tenants/memberships.
   */
  private async authenticateSocket(socket: AuthenticatedSocket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      throw new Error('Missing authentication token');
    }

    // 1. Verify JWT signature and expiration (same as JwtStrategy)
    let payload: JwtPayload;
    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      if (!secret) throw new Error('JWT_ACCESS_SECRET not configured');
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret });
    } catch {
      throw new Error('Invalid or expired token');
    }

    // 2. Verify user exists and is active (same as JwtStrategy.validate)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, platformRole: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new Error('Account inactive or not found');
    }

    // 3. Build base context
    const ctx: TenantContext = {
      userId: user.id,
      email: payload.email,
      platformRole: user.platformRole,
    };

    // 4. Resolve tenant from handshake query (same as TenantContextMiddleware)
    const tenantId = (socket.handshake.auth?.tenantId as string | undefined)
      || (socket.handshake.query?.tenantId as string | undefined);

    if (tenantId) {
      // Verify tenant is active
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, status: true },
      });

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      if (tenant.status !== 'ACTIVE') {
        throw new Error('Tenant is not active');
      }

      // Verify membership exists and is active
      const membership = await this.prisma.tenantMembership.findUnique({
        where: {
          tenantId_userId: { tenantId, userId: user.id },
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
        throw new Error('Not a member of this tenant');
      }

      if (membership.status !== 'ACTIVE') {
        throw new Error('Membership is not active');
      }

      // Filter to active branches only
      const activeBranchIds = membership.branchAssignments
        .filter((a) => a.branch.isActive)
        .map((a) => a.branchId);

      ctx.tenantId = tenantId;
      ctx.tenantRole = membership.role as TenantContext['tenantRole'];
      ctx.branchIds = activeBranchIds;

      // 5. Check KDS entitlement (required for this gateway)
      const kdsState = await this.featureResolver.resolve(tenantId, FeatureKey.KDS);
      socket.data.kdsEffective = kdsState.effective;
    }

    socket.data.tenantContext = ctx;
    socket.data.authenticatedAt = new Date();

    this.logger.debug(
      `Socket authenticated: user=${user.id} tenant=${ctx.tenantId ?? 'none'} role=${ctx.tenantRole ?? 'none'} kds=${socket.data.kdsEffective ?? 'unknown'}`,
    );
  }

  private extractToken(socket: AuthenticatedSocket): string | undefined {
    // Try auth.token first (most common for WebSocket)
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken;

    // Try Authorization header
    const authHeader = socket.handshake.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Try query.token
    const queryToken = socket.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) return queryToken;

    return undefined;
  }
}
