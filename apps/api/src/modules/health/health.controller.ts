import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private version = '0.1.0';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.version = this.config.get<string>('npm_package_version', '0.1.0');
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - process is alive' })
  live() {
    // Liveness should ONLY check that the process/event loop is alive.
    // Do NOT check external dependencies here — a temporary DB blip should not kill the pod.
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - dependencies are available' })
  async ready() {
    const checks: Record<string, string> = {};
    let allHealthy = true;

    // PostgreSQL check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'unavailable';
      allHealthy = false;
    }

    // Redis check (if configured)
    try {
      const { default: Redis } = await import('ioredis');
      const redis = new Redis({
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        connectTimeout: 2000,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
      });
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      checks.redis = pong === 'PONG' ? 'ok' : 'unavailable';
      if (checks.redis !== 'ok') allHealthy = false;
    } catch {
      checks.redis = 'unavailable';
      allHealthy = false;
    }

    // Return 503 if any dependency is unavailable
    if (!allHealthy) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        version: this.version,
        timestamp: new Date().toISOString(),
        checks,
      });
    }

    return {
      status: 'ok',
      version: this.version,
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
