import type {
  FulfillmentStatus,
  TicketType,
  TicketStatus,
  RouteType,
  ServiceMode,
  ExpoMode,
  NotificationType,
  NotificationStatus,
  OrderType,
} from '@rms/contracts';

export type { FulfillmentStatus, TicketType, TicketStatus, RouteType, ServiceMode, ExpoMode, NotificationType, NotificationStatus };

export interface Kitchen {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  description: string | null;
  collectionLabel: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenStation {
  id: string;
  tenantId: string;
  branchId: string;
  kitchenId: string | null;
  name: string;
  code: string | null;
  defaultPrepMinutes: number | null;
  isExpo: boolean;
  collectionLabelOverride: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  kitchen?: Kitchen;
}

export interface StationRoute {
  menuItemId: string;
  menuItemName: string;
  stationId: string;
  stationName: string;
  stationCode: string | null;
  kitchenId: string | null;
  routeType: RouteType;
  isRequired: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface MenuItemRouteAssignment {
  stationId: string;
  routeType: RouteType;
  isRequired: boolean;
  sortOrder: number;
}

export interface FulfillmentPolicy {
  id: string;
  tenantId: string;
  branchId: string;
  serviceMode: ServiceMode;
  expoMode: ExpoMode;
  allowWaiterSelfClaim: boolean;
  showUnassignedReadyOrdersToWaiters: boolean;
  readyReminderSeconds: number | null;
  readyEscalationSeconds: number | null;
  autoCompleteKitchenTicketOnCollected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicketLine {
  id: string;
  ticketId: string;
  orderLineId: string;
  routeType: RouteType;
  isRequired: boolean;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  notesSnapshot: string | null;
  quantity: number;
  quantityPrepared: number;
  quantityReady: number;
  quantityCollected: number;
  quantityServed: number;
  status: TicketStatus;
  readyAt: string | null;
  collectedAt: string | null;
  servedAt: string | null;
  version: number;
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  stationId: string;
  kitchenId: string | null;
  ticketNumber: string;
  ticketType: TicketType;
  status: TicketStatus;
  priority: number;
  estimatedReadyAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  collectedAt: string | null;
  releasedAt: string | null;
  lastRecalledAt: string | null;
  collectionLabelSnapshot: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  stationName?: string;
  kitchenName?: string;
  orderNumber?: string;
  tableId?: string | null;
  orderType?: OrderType;
  lines?: KitchenTicketLine[];
}

export interface StationStatus {
  stationId: string;
  stationName: string;
  kitchenName: string | null;
  collectionLabel: string | null;
  ticketId: string | null;
  status: TicketStatus | null;
  elapsed: number | null;
  isRequired: boolean;
}

export interface ExpoOrder {
  orderId: string;
  orderNumber: string;
  orderType: OrderType;
  tableId: string | null;
  tableLabel: string | null;
  customerName: string | null;
  fulfillmentStatus: FulfillmentStatus;
  stations: StationStatus[];
  totalRequired: number;
  readyCount: number;
  collectedCount: number;
  canRelease: boolean;
  canRecall: boolean;
  isReleased: boolean;
  releasedAt: string | null;
  releasedByUserId: string | null;
  createdAt: string;
  version: number;
}

export interface FulfillmentOrder {
  orderId: string;
  orderNumber: string;
  orderType: OrderType;
  tableId: string | null;
  tableLabel: string | null;
  fulfillmentStatus: FulfillmentStatus;
  assignedWaiterUserId: string | null;
  assignedWaiterName: string | null;
  totalAllocations: number;
  readyAllocations: number;
  collectedAllocations: number;
  servedAllocations: number;
  outstandingStations: string[];
  collectionPoints: string[];
  canCollect: boolean;
  canServe: boolean;
  canClaim: boolean;
  blockingReason: string | null;
  readyAge: number | null;
  createdAt: string;
  version: number;
}

export interface ServiceBoardOrder extends FulfillmentOrder {
  assignedWaiterName: string | null;
  notifications: ServiceNotification[];
}

export interface ServiceNotification {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  ticketId: string | null;
  assignedUserId: string | null;
  type: NotificationType;
  collectionLabelSnapshot: string | null;
  status: NotificationStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface KdsDevice {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  lastSeenAt: string | null;
  isActive: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  stations: KdsDeviceStation[];
}

export interface KdsDeviceStation {
  deviceId: string;
  stationId: string;
  displayOrder: number;
  stationName?: string;
}
