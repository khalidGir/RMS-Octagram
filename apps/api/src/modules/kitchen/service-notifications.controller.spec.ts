import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ServiceNotificationsController } from './service-notifications.controller';
import type { ServiceNotificationService } from './service-notification.service';

describe('notification read context boundary', () => {
  it.each(['OWNER', 'MANAGER', 'WAITER'])('maps authenticated %s context without client recipient overrides', async (role) => {
    const service = { listNotifications: vi.fn().mockResolvedValue([]) };
    const controller = new ServiceNotificationsController(service as unknown as ServiceNotificationService);
    const request = { tenantContext: { tenantId: 'tenant-1', userId: 'waiter-1', tenantRole: role },
      query: { tenantId: 'foreign', assignedUserId: 'other-waiter' },
    } as unknown as Request;
    expect(await controller.list(request, 'branch-1')).toEqual({ data: [] });
    expect(service.listNotifications).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 'branch-1', limit: 50,
      ...(role === 'WAITER' ? { assignedUserId: 'waiter-1' } : {}),
    });
  });
});
