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
import type { IncomingMessage } from 'node:http';
import { isAllowedOrigin } from '../auth/allowed-origin';
import { KDS_ROOM_ROLES } from './ws-auth.guard';

const REVALIDATION_MS = 10_000;
const REVALIDATION_DEADLINE_MS = 3_000;

type AdapterServer = ReturnType<IoAdapter['create']>;
type AdapterSocket = Parameters<Parameters<AdapterServer['use']>[0]>[0];

export interface AuthenticatedSocket extends AdapterSocket {
  data: SocketData & Record<string, unknown>;
}

export interface SocketData {
  tenantContext?: TenantContext;
  kdsEffective?: boolean;
  authenticatedAt?: Date;
  tokenExpiresAt?: Date;
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

  create(port: number, options?: Parameters<IoAdapter['create']>[1]): ReturnType<IoAdapter['create']> {
    this.initServices();

    const corsOrigin = this.configService.get<string>('API_CORS_ORIGIN', 'http://localhost:3000');
    const allowedOrigins = corsOrigin.split(',').map((o) => o.trim());

    // Nest calls create again for the gateway namespace, often reusing a root
    // server. Root server.use middleware does NOT protect a named namespace.
    // Attach authentication to the actual returned server/namespace each time.
    const server = super.create(port, {
      ...options,
      cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          callback(null, isAllowedOrigin(origin, allowedOrigins));
        },
        credentials: true,
      },
      // CORS alone does not reject browser WebSocket upgrades.
      allowRequest: (request: IncomingMessage, callback: (error: string | null, allowed: boolean) => void) => {
        callback(null, isAllowedOrigin(request.headers.origin, allowedOrigins));
      },
      connectTimeout: 10000,
    } as NonNullable<Parameters<IoAdapter['create']>[1]>);

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
    let payload: JwtPayload & { exp?: number };
    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      if (!secret) throw new Error('JWT_ACCESS_SECRET not configured');
      payload = await this.jwtService.verifyAsync<JwtPayload & { exp?: number }>(token, { secret });
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
        throw new Error('Access token must expire');
      }
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
      phone: payload.phone ?? null,
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
    const expiresAt = payload.exp! * 1000;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) throw new Error('Invalid or expired token');
    socket.data.tokenExpiresAt = new Date(expiresAt);
    const expiryTimer = setTimeout(() => socket.disconnect(true), remaining);
    expiryTimer.unref();
    let revalidating = false;
    let accessDeadline: ReturnType<typeof setTimeout> | undefined;
    const accessTimer = setInterval(() => {
      if (revalidating) return;
      revalidating = true;
      void Promise.race([
        this.revalidateSubscriptions(socket),
        new Promise<never>((_resolve, reject) => {
          accessDeadline = setTimeout(() => reject(new Error('Socket authorization deadline exceeded')), REVALIDATION_DEADLINE_MS);
          accessDeadline.unref();
        }),
      ]).catch(() => {
        // Cannot establish current authorization during a database failure.
        socket.disconnect(true);
      }).finally(() => {
        if (accessDeadline) clearTimeout(accessDeadline);
        revalidating = false;
      });
    }, REVALIDATION_MS);
    accessTimer.unref();
    socket.once('disconnect', () => {
      clearTimeout(expiryTimer);
      clearInterval(accessTimer);
      if (accessDeadline) clearTimeout(accessDeadline);
    });

    this.logger.debug(
      `Socket authenticated: user=${user.id} tenant=${ctx.tenantId ?? 'none'} role=${ctx.tenantRole ?? 'none'} kds=${socket.data.kdsEffective ?? 'unknown'}`,
    );
  }

  private async revalidateSubscriptions(socket: AuthenticatedSocket) {
    const ctx = socket.data.tenantContext;
    if (!ctx?.userId) { socket.disconnect(true); return; }
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId }, select: { status: true },
    });
    if (user?.status !== 'ACTIVE') { socket.disconnect(true); return; }
    if (!ctx.tenantId) return;
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, status: 'ACTIVE',
        tenant: { status: 'ACTIVE' }, user: { status: 'ACTIVE' } },
      select: { role: true, branchAssignments: {
        where: { tenantId: ctx.tenantId, branch: { tenantId: ctx.tenantId, isActive: true } },
        select: { branchId: true },
      } },
    });
    if (!membership) { socket.disconnect(true); return; }
    ctx.tenantRole = membership.role as TenantContext['tenantRole'];
    ctx.branchIds = membership.branchAssignments.map((assignment) => assignment.branchId);
    const handlers: Record<string, string> = {
      branch: 'handleJoinBranch', station: 'handleJoinStation', expo: 'handleJoinExpo',
      service: 'handleJoinService', waiter: 'handleJoinWaiter',
    };
    const branchAccess = new Map<string, boolean>();
    let removed = false;
    for (const room of [...socket.rooms]) {
      if (room === socket.id) continue;
      const [kind, branchId, detail, ...extra] = room.split(':');
      const handler = handlers[kind];
      let allowed = Boolean(handler && branchId && extra.length === 0
        && KDS_ROOM_ROLES[handler]?.includes(membership.role));
      if (allowed && !branchAccess.has(branchId)) {
        const branch = await this.prisma.branch.findFirst({
          where: { id: branchId, tenantId: ctx.tenantId, isActive: true }, select: { id: true },
        });
        const assigned = membership.role === 'OWNER' || ctx.branchIds.includes(branchId);
        const feature = branch && assigned
          ? await this.featureResolver.resolve(ctx.tenantId, FeatureKey.KDS, branchId) : null;
        branchAccess.set(branchId, Boolean(branch && assigned && feature?.effective));
      }
      allowed = allowed && branchAccess.get(branchId) === true;
      if (allowed && kind === 'station') {
        const station = detail ? await this.prisma.kitchenStation.findFirst({
          where: { id: detail, tenantId: ctx.tenantId, branchId, isActive: true,
            kitchen: { tenantId: ctx.tenantId, branchId, isActive: true } }, select: { id: true },
        }) : null;
        allowed = Boolean(station);
      } else if (allowed && kind === 'waiter') {
        allowed = Boolean(detail && (detail === ctx.userId || ['OWNER', 'MANAGER'].includes(membership.role)));
      } else if (allowed && detail) {
        allowed = false;
      }
      if (!allowed) { await socket.leave(room); removed = true; }
    }
    if (removed) socket.emit('exception', { message: 'Live access changed; select a permitted branch or reconnect' });
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
