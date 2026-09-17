export type KdsSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface KdsTicketEvent {
  id: string;
  orderId: string;
  stationId: string;
  ticketNumber: string;
  status: string;
  priority: number;
  estimatedReadyAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  stationName?: string;
  orderNumber?: string;
  tableId?: string | null;
  customerName?: string | null;
  lines?: Array<{
    id: string;
    orderLineId: string;
    quantity: number;
    status: string;
    itemName?: string;
    variantName?: string;
    notes?: string | null;
  }>;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  stationId: string;
  ticketNumber: string;
  status: string;
  priority: number;
  estimatedReadyAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  stationName?: string;
  orderNumber?: string;
  tableId?: string | null;
  customerName?: string | null;
  lines?: Array<{
    id: string;
    orderLineId: string;
    quantity: number;
    status: string;
    itemName?: string;
    variantName?: string;
    notes?: string | null;
  }>;
}

export interface KdsStation {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  menuItemIds: string[];
}
