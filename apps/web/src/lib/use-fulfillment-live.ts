'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { useKdsSocket } from './use-kds-socket';

/** Events invalidate scoped queues; committed HTTP reads remain authoritative. */
export function useFulfillmentLive(enabled: boolean) {
  const { accessToken, profile } = useAuth();
  const { branchId } = useBranch();
  const tenantId = profile?.memberships[0]?.tenant.id ?? '';
  const queries = useQueryClient();
  const reconcile = () => {
    for (const queue of ['expo-orders', 'service-board', 'service-notifications']) {
      void queries.invalidateQueries({ queryKey: [queue, tenantId, branchId] });
    }
  };
  const connection = useKdsSocket({
    branchId: enabled ? branchId : '', tenantId, accessToken,
    onConnect: () => {
      const role = profile?.memberships[0]?.role;
      if (role === 'WAITER' || role === 'OWNER') {
        connection.emit('join:service', { branchId });
        if (profile?.id) connection.emit('join:waiter', { branchId, userId: profile.id });
      } else {
        connection.emit('join:expo', { branchId });
      }
      reconcile();
    }, onTicketCreated: reconcile, onTicketUpdated: reconcile,
    onOrderConfirmed: reconcile, onOperationalChange: reconcile,
  });
  return connection;
}
