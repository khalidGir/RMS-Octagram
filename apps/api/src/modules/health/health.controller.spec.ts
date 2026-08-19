import { vi, describe, it, expect, beforeEach } from 'vitest';
import { HealthController } from './health.controller';
import type { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    controller = new HealthController(prisma);
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

  it('should return degraded when postgres fails', async () => {
    const failPrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as unknown as PrismaService;
    const failController = new HealthController(failPrisma);
    const result = await failController.ready();
    expect(result).toHaveProperty('status', 'degraded');
    expect(result.checks).toHaveProperty('postgres', 'unavailable');
  });
});
