import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { OutboxController } from './outbox.controller';
import type { OutboxProcessor } from './outbox.processor';

function setup(role = 'OWNER', branchIds: string[] = ['branch-1']) {
  const processor = { getStats: vi.fn(), getDeadLetterEvents: vi.fn(), retryDeadLetter: vi.fn() };
  const controller = new OutboxController(processor as unknown as OutboxProcessor);
  const request = { tenantContext: { tenantId: 'tenant-1', userId: 'authenticated-actor', tenantRole: role, branchIds },
    body: { actorUserId: 'forged-actor', tenantId: 'foreign-tenant' },
  } as unknown as Request;
  return { processor, controller, request };
}

describe('outbox diagnostic context boundary', () => {
  it('takes tenant and retry audit actor from authentication, never the request body', async () => {
    const { processor, controller, request } = setup();
    await controller.retryDeadLetter('event-1', request);
    expect(processor.retryDeadLetter).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, 'event-1', 'authenticated-actor');
  });

  it('limits Manager diagnostics to assigned branches', async () => {
    const { processor, controller, request } = setup('MANAGER');
    await controller.getStats(request);
    await controller.getDeadLetter(request);
    expect(processor.getStats).toHaveBeenCalledWith({ tenantId: 'tenant-1', branchIds: ['branch-1'] });
    expect(processor.getDeadLetterEvents).toHaveBeenCalledWith({ tenantId: 'tenant-1', branchIds: ['branch-1'] });
  });

  it('does not treat an empty Manager assignment as unrestricted access', async () => {
    const { processor, controller, request } = setup('MANAGER', []);
    await controller.getStats(request);
    expect(processor.getStats).toHaveBeenCalledWith({ tenantId: 'tenant-1', branchIds: [] });
  });

  it('fails closed without an authorized tenant context', async () => {
    const { processor, controller } = setup();
    await expect(controller.getStats({} as Request)).rejects.toMatchObject({ status: 403 });
    expect(processor.getStats).not.toHaveBeenCalled();
  });
});
