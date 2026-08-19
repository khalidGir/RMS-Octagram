import {
  Injectable,
  UnauthorizedException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string | null;
  platformRole: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** In-memory rate limiter: 10 failed attempts per email per 15 minutes */
const FAILED_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  private checkRateLimit(email: string): void {
    const now = Date.now();
    const record = FAILED_ATTEMPTS.get(email);

    if (record && now < record.resetAt) {
      if (record.count >= RATE_LIMIT_MAX) {
        const remaining = Math.ceil((record.resetAt - now) / 1000);
        throw new HttpException(
          `Too many failed attempts. Try again in ${remaining} seconds`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } else {
      FAILED_ATTEMPTS.set(email, { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS });
    }
  }

  private recordFailedAttempt(email: string): void {
    const record = FAILED_ATTEMPTS.get(email);
    if (record) {
      record.count++;
    }
  }

  private clearFailedAttempts(email: string): void {
    FAILED_ATTEMPTS.delete(email);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    this.checkRateLimit(email);

    const user = await this.prisma.user.findFirst({
      where: { email, status: 'ACTIVE' },
    });

    if (!user) {
      this.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.verifyPassword(user.passwordHash, password);
    if (!valid) {
      this.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.clearFailedAttempts(email);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokenPair(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const parts = refreshToken.split(':');
    if (parts.length !== 2) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [selector, secret] = parts;

    const selectorHash = createHash('sha256').update(selector).digest('hex');
    const session = await this.prisma.authSession.findUnique({
      where: { selectorHash },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check expiry first
    if (session.expiresAt < new Date()) {
      await this.prisma.authSession.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Verify the secret BEFORE checking revocation status
    const secretValid = await argon2.verify(session.refreshTokenHash, secret);
    if (!secretValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Secret is valid. Now check if already revoked (reuse detection).
    if (session.revokedAt) {
      this.logger.warn(
        `Refresh token family reuse detected for user ${session.userId}, family ${session.familyId}`,
      );
      // Revoke entire family — but only after confirming secret is valid
      await this.prisma.authSession.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Token reuse detected — all sessions revoked');
    }

    // Verify user still active
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user || user.status !== 'ACTIVE') {
      await this.prisma.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Account inactive');
    }

    // Atomic rotation: conditional update + create successor
    const newRefreshRaw = this.generateRefreshToken();
    const newSelectorHash = createHash('sha256').update(newRefreshRaw.selector).digest('hex');
    const newRefreshHash = await argon2.hash(newRefreshRaw.secret);

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresMs = this.parseDuration(refreshExpiresIn);

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional update: only revoke if still active (prevents concurrent rotation)
      const updated = await tx.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null, // Precondition: must not already be revoked
        },
        data: { revokedAt: new Date() },
      });

      if (updated.count === 0) {
        throw new UnauthorizedException('Token already rotated');
      }

      // Create successor in same family
      await tx.authSession.create({
        data: {
          userId: user.id,
          selectorHash: newSelectorHash,
          refreshTokenHash: newRefreshHash,
          familyId: session.familyId,
          expiresAt: new Date(Date.now() + expiresMs),
        },
      });

      return this.issueAccessToken(user);
    });

    return {
      accessToken: result,
      refreshToken: `${newRefreshRaw.selector}:${newRefreshRaw.secret}`,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const parts = refreshToken.split(':');
    if (parts.length !== 2) return;

    const [selector] = parts;
    const selectorHash = createHash('sha256').update(selector).digest('hex');

    await this.prisma.authSession.updateMany({
      where: { selectorHash },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phoneE164: true,
        displayName: true,
        platformRole: true,
        status: true,
        memberships: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            role: true,
            tenant: {
              select: { id: true, name: true, slug: true, status: true },
            },
            branchAssignments: {
              select: {
                branchId: true,
                branch: {
                  select: { id: true, name: true, slug: true, isActive: true },
                },
              },
            },
          },
        },
      },
    });
  }

  private async generateTokenPair(user: {
    id: string;
    email: string | null;
    platformRole: string | null;
    familyId?: string;
  }): Promise<TokenPair> {
    const accessToken = this.issueAccessToken(user);

    const refreshRaw = this.generateRefreshToken();
    const familyId = user.familyId || crypto.randomUUID();

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresMs = this.parseDuration(refreshExpiresIn);

    const selectorHash = createHash('sha256').update(refreshRaw.selector).digest('hex');
    const refreshHash = await argon2.hash(refreshRaw.secret);

    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        selectorHash,
        refreshTokenHash: refreshHash,
        familyId,
        expiresAt: new Date(Date.now() + expiresMs),
      },
    });

    return {
      accessToken,
      refreshToken: `${refreshRaw.selector}:${refreshRaw.secret}`,
    };
  }

  private issueAccessToken(user: {
    id: string;
    email: string | null;
    platformRole: string | null;
  }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
    };
    return this.jwtService.sign(payload);
  }

  private generateRefreshToken(): { selector: string; secret: string } {
    return {
      selector: randomBytes(16).toString('hex'),
      secret: randomBytes(32).toString('hex'),
    };
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
