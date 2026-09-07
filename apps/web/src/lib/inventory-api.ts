import { apiRequest } from './api-client';

export interface InventoryItem {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  sku: string | null;
  baseUnit: string;
  lowStockThreshold: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItemsResponse {
  items: InventoryItem[];
  nextCursor?: string;
}

export interface CreateInventoryItemPayload {
  name: string;
  sku?: string;
  baseUnit: string;
  lowStockThreshold?: number;
}

export interface UpdateInventoryItemPayload {
  name?: string;
  sku?: string;
  lowStockThreshold?: number;
  isActive?: boolean;
}

export interface InventoryMovement {
  id: string;
  tenantId: string;
  branchId: string;
  inventoryItemId: string;
  batchId: string | null;
  movementType: string;
  quantity: string;
  unit: string;
  orderId: string | null;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface MovementsResponse {
  movements: InventoryMovement[];
  nextCursor?: string;
}

export interface ReceiveBatchPayload {
  batchCode: string;
  receivedQuantity: number;
  unit: string;
  portionCount?: number;
  costMinor?: number;
  expiresAt?: string;
  idempotencyKey?: string;
}

export interface ReceiveBatchResponse {
  movement: InventoryMovement;
  batch: {
    id: string;
    batchCode: string;
    receivedQuantity: string;
    remainingQuantity: string;
    unit: string;
    portionCount: number | null;
    remainingPortions: number | null;
    costMinor: string | null;
    receivedAt: string;
    expiresAt: string | null;
  };
  idempotent: boolean;
}

export interface AdjustmentPayload {
  quantity: number;
  unit: string;
  reason: string;
  batchId?: string;
  idempotencyKey?: string;
}

export interface WastePayload {
  quantity: number;
  unit: string;
  reason: string;
  batchId?: string;
  idempotencyKey?: string;
}

export interface LowStockAlert {
  id: string;
  name: string;
  sku: string | null;
  baseUnit: string;
  lowStockThreshold: string;
  currentStock: number;
  isLow: boolean;
}

export interface LowStockAlertsResponse {
  alerts: LowStockAlert[];
}

export async function fetchInventoryItems(
  branchId: string,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
  opts?: { isActive?: boolean; search?: string; after?: string },
): Promise<InventoryItemsResponse> {
  const qs = new URLSearchParams();
  if (opts?.isActive !== undefined) qs.set('isActive', String(opts.isActive));
  if (opts?.search) qs.set('search', opts.search);
  if (opts?.after) qs.set('after', opts.after);
  qs.set('limit', '50');
  const q = qs.toString();
  return apiRequest(`/branches/${branchId}/inventory/items${q ? `?${q}` : ''}`, {
    accessToken, csrfToken, tenantId,
  });
}

export async function createInventoryItem(
  branchId: string,
  payload: CreateInventoryItemPayload,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<InventoryItem> {
  return apiRequest(`/branches/${branchId}/inventory/items`, {
    method: 'POST',
    body: payload,
    accessToken, csrfToken, tenantId,
  });
}

export async function updateInventoryItem(
  branchId: string,
  itemId: string,
  payload: UpdateInventoryItemPayload,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<InventoryItem> {
  return apiRequest(`/branches/${branchId}/inventory/items/${itemId}`, {
    method: 'PATCH',
    body: payload,
    accessToken, csrfToken, tenantId,
  });
}

export async function receiveBatch(
  branchId: string,
  itemId: string,
  payload: ReceiveBatchPayload,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<ReceiveBatchResponse> {
  return apiRequest(`/branches/${branchId}/inventory/items/${itemId}/batches`, {
    method: 'POST',
    body: payload,
    accessToken, csrfToken, tenantId,
  });
}

export async function fetchMovements(
  branchId: string,
  itemId: string,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
  opts?: { movementType?: string; after?: string },
): Promise<MovementsResponse> {
  const qs = new URLSearchParams();
  if (opts?.movementType) qs.set('movementType', opts.movementType);
  if (opts?.after) qs.set('after', opts.after);
  qs.set('limit', '50');
  const q = qs.toString();
  return apiRequest(`/branches/${branchId}/inventory/items/${itemId}/movements${q ? `?${q}` : ''}`, {
    accessToken, csrfToken, tenantId,
  });
}

export async function recordAdjustment(
  branchId: string,
  itemId: string,
  payload: AdjustmentPayload,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<InventoryMovement> {
  return apiRequest(`/branches/${branchId}/inventory/items/${itemId}/adjustments`, {
    method: 'POST',
    body: payload,
    accessToken, csrfToken, tenantId,
  });
}

export async function recordWaste(
  branchId: string,
  itemId: string,
  payload: WastePayload,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<InventoryMovement> {
  return apiRequest(`/branches/${branchId}/inventory/items/${itemId}/waste`, {
    method: 'POST',
    body: payload,
    accessToken, csrfToken, tenantId,
  });
}

export async function fetchLowStockAlerts(
  branchId: string,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<LowStockAlertsResponse> {
  return apiRequest(`/branches/${branchId}/inventory/alerts`, {
    accessToken, csrfToken, tenantId,
  });
}
