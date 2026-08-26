import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import type { ConfigService } from '@nestjs/config';

export interface ThrottlerStorageRecord {
  totalHits: number;
  isBlocked: boolean;
  timeToExpire: number;
  timeToBlockExpire: number;
  blockDuration: number;
}

@Injectable()
export class RedisThrottlerStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private redis: Redis | null = null;
  private readonly prefix = 'throttler:';
  private inMemoryStore = new Map<string, { count: number; expiresAt: number; blockedUntil?: number }>();

  constructor(private readonly config: ConfigService) {
    this.connect();
  }

  private connect() {
    try {
      const host = this.config.get<string>('REDIS_HOST', 'localhost');
      const port = this.config.get<number>('REDIS_PORT', 6379);
      const password = this.config.get<string>('REDIS_PASSWORD');

      this.redis = new Redis({
        host,
        port,
        password: password || undefined,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redis.connect().catch((err) => {
        this.logger.warn(`Redis connection failed (falling back to in-memory): ${err.message}`);
        this.redis = null;
      });

      this.redis.on('error', (err) => {
        this.logger.warn(`Redis error: ${err.message}`);
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for rate limiting');
      });
    } catch {
      this.logger.warn('Redis not available for rate limiting, using in-memory fallback');
      this.redis = null;
    }
  }

  async incrementAndCheck(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<{ blocked: boolean; count: number; retryAfter?: number }> {
    if (!this.redis) {
      return this.inMemoryIncrementAndCheck(key, ttl, limit, blockDuration);
    }

    try {
      const redisKey = this.prefix + key;
      const blockKey = `${redisKey}:block`;

      // Check if already blocked
      const blockedTtl = await this.redis.pttl(blockKey);
      if (blockedTtl > 0) {
        return { blocked: true, count: limit, retryAfter: Math.ceil(blockedTtl / 1000) };
      }

      // Increment counter
      const count = await this.redis.incr(redisKey);
      await this.redis.pexpire(redisKey, ttl);

      if (count > limit) {
        // Block the key
        if (blockDuration > 0) {
          await this.redis.set(blockKey, '1', 'PX', blockDuration * 1000);
        }
        const retryAfter = blockDuration > 0 ? blockDuration : Math.ceil(ttl / 1000);
        return { blocked: true, count, retryAfter };
      }

      return { blocked: false, count };
    } catch (err) {
      this.logger.warn(`Redis rate limit check failed, falling back to in-memory: ${err}`);
      return this.inMemoryIncrementAndCheck(key, ttl, limit, blockDuration);
    }
  }

  async onApplicationShutdown() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private inMemoryIncrementAndCheck(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): { blocked: boolean; count: number; retryAfter?: number } {
    const now = Date.now();
    const record = this.inMemoryStore.get(key);

    // Check if blocked
    if (record?.blockedUntil && now < record.blockedUntil) {
      return { blocked: true, count: limit, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
    }

    if (!record || now > record.expiresAt) {
      this.inMemoryStore.set(key, { count: 1, expiresAt: now + ttl });
      return { blocked: false, count: 1 };
    }

    record.count++;
    if (record.count > limit) {
      if (blockDuration > 0) {
        record.blockedUntil = now + blockDuration * 1000;
      }
      const retryAfter = blockDuration > 0 ? blockDuration : Math.ceil(ttl / 1000);
      return { blocked: true, count: record.count, retryAfter };
    }

    return { blocked: false, count: record.count };
  }
}
