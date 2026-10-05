import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RedisThrottlerStorage } from './redis-throttler-storage';
import type { ThrottleOptions } from './throttle-options.interface';

export const THROTTLE_OPTIONS_KEY = 'throttle_options';

/**
 * Custom throttler guard with Redis-backed distributed rate limiting.
 * Supports per-route configuration via @Throttle() decorator.
 * Rate limits by normalized client IP + optional account/tenant identifiers.
 */
@Injectable()
export class AppThrottlerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storage: RedisThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ThrottleOptions>(THROTTLE_OPTIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) return true; // No throttle config = no limit

    const request = context.switchToHttp().getRequest() as Record<string, unknown>;
    const key = this.generateKey(request, options);

    const result = await this.storage.incrementAndCheck(
      key,
      options.ttl,
      options.limit,
      options.blockDuration ?? 0,
    );

    if (result.blocked) {
      const retryAfter = result.retryAfter ?? Math.ceil(options.ttl / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests. Retry after ${retryAfter} seconds.`,
          error: 'Too Many Requests',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private generateKey(request: Record<string, unknown>, options: ThrottleOptions): string {
    const ip = this.getClientIp(request);
    const tenantContext = request.tenantContext as Record<string, unknown> | undefined;
    const tenantId = tenantContext?.tenantId as string | undefined;
    const userId = tenantContext?.userId as string | undefined;

    const parts = [options.keyPrefix ?? options.name ?? 'global', ip];
    if (tenantId) parts.push(`t:${tenantId}`);
    if (userId) parts.push(`u:${userId}`);

    return parts.join(':');
  }

  private getClientIp(request: Record<string, unknown>): string {
    const headers = request.headers as Record<string, string> | undefined;
    if (!headers) return 'unknown';

    // With trust proxy configured, X-Forwarded-For is reliable
    const forwarded = headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const firstIp = forwarded.split(',')[0]?.trim();
      if (firstIp) return firstIp;
    }

    const realIp = headers['x-real-ip'];
    if (typeof realIp === 'string') return realIp;

    const socket = request.socket as Record<string, unknown> | undefined;
    return (socket?.remoteAddress as string) ?? 'unknown';
  }
}
