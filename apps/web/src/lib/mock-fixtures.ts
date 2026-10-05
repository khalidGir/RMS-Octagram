import type {
  Kitchen,
  StationRoute,
  FulfillmentPolicy,
  KitchenTicket,
  ExpoOrder,
  ServiceBoardOrder,
  FulfillmentStatus,
  TicketStatus,
  TicketType,
  RouteType,
  ServiceMode,
  ExpoMode,
  ServiceNotificationType,
  ServiceNotificationStatus,
} from './fulfillment-types';
import { OrderType } from '@rms/contracts';

const now = new Date().toISOString();

const mockKitchens: Kitchen[] = [
  { id: 'k-1', tenantId: 't1', branchId: 'b1', name: 'Main Kitchen', description: 'Primary hot kitchen', collectionLabel: 'Main pass', displayOrder: 0, isActive: true, createdAt: now, updatedAt: now },
  { id: 'k-2', tenantId: 't1', branchId: 'b1', name: 'Bar', description: 'Drinks and cocktails', collectionLabel: 'Bar counter', displayOrder: 1, isActive: true, createdAt: now, updatedAt: now },
  { id: 'k-3', tenantId: 't1', branchId: 'b1', name: 'Bakery', description: 'Desserts and pastries', collectionLabel: 'Dessert window', displayOrder: 2, isActive: true, createdAt: now, updatedAt: now },
];

const mockRoutes: StationRoute[] = [
  { menuItemId: 'mi-1', menuItemName: 'Special Tibs', stationId: 's-1', stationName: 'Grill', stationCode: 'GRILL', kitchenId: 'k-1', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 0, createdAt: now },
  { menuItemId: 'mi-2', menuItemName: 'Shiro Wot', stationId: 's-2', stationName: 'Hot Line', stationCode: 'HOT', kitchenId: 'k-1', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 0, createdAt: now },
  { menuItemId: 'mi-3', menuItemName: 'Buna Ceremony', stationId: 's-3', stationName: 'Drinks', stationCode: 'DRN', kitchenId: 'k-2', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 0, createdAt: now },
  { menuItemId: 'mi-4', menuItemName: 'House Baklava', stationId: 's-4', stationName: 'Dessert', stationCode: 'DST', kitchenId: 'k-3', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 0, createdAt: now },
  { menuItemId: 'mi-5', menuItemName: 'Combo Platter', stationId: 's-1', stationName: 'Grill', stationCode: 'GRILL', kitchenId: 'k-1', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 0, createdAt: now },
  { menuItemId: 'mi-5', menuItemName: 'Combo Platter', stationId: 's-2', stationName: 'Hot Line', stationCode: 'HOT', kitchenId: 'k-1', routeType: 'PREPARE' as RouteType, isRequired: true, sortOrder: 1, createdAt: now },
];

const mockPolicy: FulfillmentPolicy = {
  id: 'fp-1', tenantId: 't1', branchId: 'b1',
  serviceMode: 'ALL_AT_ONCE' as ServiceMode,
  expoMode: 'NONE' as ExpoMode,
  allowWaiterSelfClaim: true,
  showUnassignedReadyOrdersToWaiters: true,
  readyReminderSeconds: 300,
  readyEscalationSeconds: 600,
  autoCompleteKitchenTicketOnCollected: false,
  createdAt: now, updatedAt: now,
};

const mockTickets: KitchenTicket[] = [
  {
    id: 't-1', orderId: 'o-1', stationId: 's-1', kitchenId: 'k-1', ticketNumber: '001',
    ticketType: 'PREPARATION' as TicketType, status: 'IN_PROGRESS' as TicketStatus, priority: 0,
    estimatedReadyAt: null, startedAt: now, readyAt: null, completedAt: null,
    collectedAt: null, releasedAt: null, lastRecalledAt: null,
    collectionLabelSnapshot: 'Main pass', version: 2, createdAt: now, updatedAt: now,
    stationName: 'Grill', kitchenName: 'Main Kitchen', orderNumber: '1048',
    tableId: 'tbl-8', orderType: OrderType.DINE_IN,
    lines: [
      { id: 'tl-1', ticketId: 't-1', orderLineId: 'ol-1', routeType: 'PREPARE' as RouteType, isRequired: true,
        itemNameSnapshot: 'Special Tibs', variantNameSnapshot: 'Large', notesSnapshot: 'Extra spicy',
        quantity: 2, quantityPrepared: 1, quantityReady: 0, quantityCollected: 0, quantityServed: 0,
        status: 'IN_PROGRESS' as TicketStatus, readyAt: null, collectedAt: null, servedAt: null, version: 1 },
    ],
  },
  {
    id: 't-2', orderId: 'o-1', stationId: 's-3', kitchenId: 'k-2', ticketNumber: '001',
    ticketType: 'PREPARATION' as TicketType, status: 'READY' as TicketStatus, priority: 0,
    estimatedReadyAt: null, startedAt: now, readyAt: now, completedAt: null,
    collectedAt: null, releasedAt: null, lastRecalledAt: null,
    collectionLabelSnapshot: 'Bar counter', version: 3, createdAt: now, updatedAt: now,
    stationName: 'Drinks', kitchenName: 'Bar', orderNumber: '1048',
    tableId: 'tbl-8', orderType: OrderType.DINE_IN,
    lines: [
      { id: 'tl-2', ticketId: 't-2', orderLineId: 'ol-2', routeType: 'PREPARE' as RouteType, isRequired: true,
        itemNameSnapshot: 'Buna Ceremony', variantNameSnapshot: null, notesSnapshot: null,
        quantity: 1, quantityPrepared: 1, quantityReady: 1, quantityCollected: 0, quantityServed: 0,
        status: 'READY' as TicketStatus, readyAt: now, collectedAt: null, servedAt: null, version: 1 },
    ],
  },
  {
    id: 't-3', orderId: 'o-2', stationId: 's-4', kitchenId: 'k-3', ticketNumber: '001',
    ticketType: 'PREPARATION' as TicketType, status: 'QUEUED' as TicketStatus, priority: 0,
    estimatedReadyAt: null, startedAt: null, readyAt: null, completedAt: null,
    collectedAt: null, releasedAt: null, lastRecalledAt: null,
    collectionLabelSnapshot: 'Dessert window', version: 1, createdAt: now, updatedAt: now,
    stationName: 'Dessert', kitchenName: 'Bakery', orderNumber: '1049',
    tableId: null, orderType: OrderType.TAKEAWAY,
    lines: [
      { id: 'tl-3', ticketId: 't-3', orderLineId: 'ol-3', routeType: 'PREPARE' as RouteType, isRequired: true,
        itemNameSnapshot: 'House Baklava', variantNameSnapshot: null, notesSnapshot: null,
        quantity: 3, quantityPrepared: 0, quantityReady: 0, quantityCollected: 0, quantityServed: 0,
        status: 'QUEUED' as TicketStatus, readyAt: null, collectedAt: null, servedAt: null, version: 1 },
    ],
  },
];

const mockExpoOrders: ExpoOrder[] = [
  {
    orderId: 'o-1', orderNumber: '1048', orderType: OrderType.DINE_IN,
    tableId: 'tbl-8', tableLabel: 'Table 8', customerName: null,
    fulfillmentStatus: 'PARTIALLY_READY' as FulfillmentStatus,
    stations: [
      { stationId: 's-1', stationName: 'Grill', kitchenName: 'Main Kitchen', collectionLabel: 'Main pass', ticketId: 't-1', status: 'IN_PROGRESS' as TicketStatus, elapsed: 480, isRequired: true },
      { stationId: 's-3', stationName: 'Drinks', kitchenName: 'Bar', collectionLabel: 'Bar counter', ticketId: 't-2', status: 'READY' as TicketStatus, elapsed: 120, isRequired: true },
    ],
    totalRequired: 2, readyCount: 1, collectedCount: 0, canRelease: false, canRecall: false,
    isReleased: false, releasedAt: null, releasedByUserId: null, createdAt: now, version: 3,
  },
];

const mockServiceBoard: ServiceBoardOrder[] = [
  {
    orderId: 'o-1', orderNumber: '1048', orderType: OrderType.DINE_IN,
    tableId: 'tbl-8', tableLabel: 'Table 8', fulfillmentStatus: 'PARTIALLY_READY' as FulfillmentStatus,
    assignedWaiterUserId: 'u-waiter-1', assignedWaiterName: 'Abebe',
    totalAllocations: 2, readyAllocations: 1, collectedAllocations: 0, servedAllocations: 0,
    outstandingStations: ['Grill'], collectionPoints: ['Bar counter'],
    canCollect: true, canServe: false, canClaim: false, blockingReason: 'Waiting for Grill',
    readyAge: 120, createdAt: now, version: 3,
    notifications: [
      { id: 'n-1', tenantId: 't1', branchId: 'b1', orderId: 'o-1', ticketId: 't-2',
        assignedUserId: 'u-waiter-1', type: 'STATION_READY' as ServiceNotificationType,
        collectionLabelSnapshot: 'Bar counter', status: 'UNREAD' as ServiceNotificationStatus,
        createdAt: now, acknowledgedAt: null, resolvedAt: null },
    ],
  },
  {
    orderId: 'o-2', orderNumber: '1049', orderType: OrderType.TAKEAWAY,
    tableId: null, tableLabel: null, fulfillmentStatus: 'QUEUED' as FulfillmentStatus,
    assignedWaiterUserId: null, assignedWaiterName: null,
    totalAllocations: 1, readyAllocations: 0, collectedAllocations: 0, servedAllocations: 0,
    outstandingStations: ['Dessert'], collectionPoints: [],
    canCollect: false, canServe: false, canClaim: true, blockingReason: 'Not ready',
    readyAge: null, createdAt: now, version: 1,
    notifications: [],
  },
];

export function getMockData(path: string): unknown {
  if (path.includes('/kitchens') && !path.includes('/stations')) return mockKitchens;
  if (path.includes('/kitchen-tickets')) return mockTickets;
  if (path.includes('/station-routes')) return mockRoutes;
  if (path.includes('/fulfillment-policy')) return mockPolicy;
  if (path.includes('/expo/orders')) return mockExpoOrders;
  if (path.includes('/service-board')) return mockServiceBoard;
  if (path.includes('/kds-devices')) return [];
  if (path.includes('/menu-items') && path.includes('/routes')) return mockRoutes.filter(r => path.includes(r.menuItemId));
  return [];
}
