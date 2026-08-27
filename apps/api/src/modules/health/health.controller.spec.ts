import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: PrismaService;
  let config: ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    config = {
      get: vi.fn((key: string, defaultValue: unknown) => {
        if (key === 'npm_package_version') return '0.1.0';
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        if (key === 'REDIS_PASSWORD') return undefined;
        return defaultValue;
      }),
    } as unknown as ConfigService;
    controller = new HealthController(prisma, config);
  });

  it('should return live status', () => {
    const result = controller.live();
    expect(result).toHaveProperty('status', 'ok');
    expect(result).toHaveProperty('timestamp');
  });

  it('should return ready status with postgres ok', async () => {
    const result = await controller.ready();
    expect(result).toHaveProperty('status', 'ok');
    expect(result.checks).toHaveProperty('postgres', 'ok');
  });

  it('should throw 503 when postgres fails', async () => {
    const failPrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as unknown as PrismaService;
    const failController = new HealthController(failPrisma, config);

    try {
      await failController.ready();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const response = (err as ServiceUnavailableException).getResponse() as Record<string, unknown>;
      expect(response.status).toBe('degraded');
      expect(response.checks).toHaveProperty('postgres', 'unavailable');
    }
  });
});
