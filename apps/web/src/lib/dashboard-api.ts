import { apiRequest, type ApiEnvelope } from './api-client';

const TIMEZONE = 'Africa/Addis_Ababa';

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

export interface RevenueDay {
  date: string;
  revenueMinor: string;
  currency: string;
  orderCount: number;
  avgOrderMinor: string;
}

export interface RevenueByDayResponse {
  timezone: string;
  fromLocalDate: string;
  toLocalDate: string;
  days: RevenueDay[];
}

export interface OrderStats {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  voidedOrders: number;
  avgOrderMinor: string;
  totalRevenueMinor: string;
  currency: string;
}

export interface OrdersReportResponse {
  timezone: string;
  stats: OrderStats;
}

export interface BestSellerItem {
  variantId: string;
  itemName: string;
  variantName: string;
  totalQuantity: number;
  totalRevenueMinor: string;
  currency: string;
  orderCount: number;
}

export interface BestSellersResponse {
  timezone: string;
  items: BestSellerItem[];
}

export interface LowStockItem {
  inventoryItemId: string;
  itemName: string;
  baseUnit: string;
  currentStock: string;
  threshold: string;
  isLow: boolean;
  branchId: string;
  branchName: string;
}

export interface LowStockResponse {
  items: LowStockItem[];
}

export interface RevenueByMethod {
  method: string;
  totalMinor: string;
  currency: string;
  paymentCount: number;
  avgMinor: string;
}

export interface RevenueByMethodResponse {
  timezone: string;
  methods: RevenueByMethod[];
}

export interface PeakHour {
  hour: string;
  orderCount: number;
  revenueMinor: string;
}

export interface PeakHoursResponse {
  timezone: string;
  hours: PeakHour[];
}

interface ReportParams {
  branchId: string;
  fromLocalDate?: string;
  toLocalDate?: string;
}

function reportQs(params: ReportParams): string {
  const qs = new URLSearchParams();
  qs.set('branchId', params.branchId);
  if (params.fromLocalDate) qs.set('fromLocalDate', params.fromLocalDate);
  if (params.toLocalDate) qs.set('toLocalDate', params.toLocalDate);
  qs.set('timezone', TIMEZONE);
  return qs.toString();
}

export async function fetchRevenueByDay(
  params: ReportParams,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<RevenueByDayResponse> {
  const qs = reportQs(params);
  const res = await apiRequest<ApiEnvelope<RevenueByDayResponse>>(`/reports/revenue?${qs}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export async function fetchOrdersReport(
  params: ReportParams,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<OrdersReportResponse> {
  const qs = reportQs(params);
  const res = await apiRequest<ApiEnvelope<OrdersReportResponse>>(`/reports/orders?${qs}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export async function fetchBestSellers(
  params: ReportParams & { limit?: number },
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<BestSellersResponse> {
  const qs = new URLSearchParams();
  qs.set('branchId', params.branchId);
  if (params.fromLocalDate) qs.set('fromLocalDate', params.fromLocalDate);
  if (params.toLocalDate) qs.set('toLocalDate', params.toLocalDate);
  qs.set('timezone', TIMEZONE);
  if (params.limit) qs.set('limit', String(params.limit));
  const res = await apiRequest<ApiEnvelope<BestSellersResponse>>(`/reports/best-sellers?${qs.toString()}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export async function fetchLowStock(
  branchId: string,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<LowStockResponse> {
  const qs = new URLSearchParams({ branchId });
  const res = await apiRequest<ApiEnvelope<LowStockResponse>>(`/reports/low-stock?${qs}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export async function fetchRevenueByMethod(
  params: ReportParams,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<RevenueByMethodResponse> {
  const qs = reportQs(params);
  const res = await apiRequest<ApiEnvelope<RevenueByMethodResponse>>(`/reports/revenue-by-method?${qs}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export async function fetchPeakHours(
  params: ReportParams,
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<PeakHoursResponse> {
  const qs = reportQs(params);
  const res = await apiRequest<ApiEnvelope<PeakHoursResponse>>(`/reports/peak-hours?${qs}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}

export { today, daysAgo, TIMEZONE };

export interface InventoryConsumptionItem {
  inventoryItemId: string;
  itemName: string;
  movementType: string;
  totalQuantity: string;
  movementCount: number;
}

export interface InventoryConsumptionResponse {
  timezone: string;
  items: InventoryConsumptionItem[];
}

export async function fetchInventoryConsumption(
  params: ReportParams & { movementType?: string },
  accessToken: string,
  csrfToken: string | null,
  tenantId: string,
): Promise<InventoryConsumptionResponse> {
  const qs = new URLSearchParams();
  qs.set('branchId', params.branchId);
  if (params.fromLocalDate) qs.set('fromLocalDate', params.fromLocalDate);
  if (params.toLocalDate) qs.set('toLocalDate', params.toLocalDate);
  qs.set('timezone', TIMEZONE);
  if (params.movementType) qs.set('movementType', params.movementType);
  const res = await apiRequest<ApiEnvelope<InventoryConsumptionResponse>>(`/reports/inventory-consumption?${qs.toString()}`, {
    accessToken, csrfToken, tenantId,
  });
  return res.data;
}
