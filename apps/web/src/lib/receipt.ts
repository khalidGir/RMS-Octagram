export interface ReceiptLineModifier {
  name: string;
  quantity: number;
  unitPriceDeltaMinor: string;
  totalDeltaMinor: string;
}

export interface ReceiptLine {
  itemName: string;
  variantName: string | null;
  quantity: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  modifiers: ReceiptLineModifier[];
}

export interface ReceiptData {
  receiptNumber: string;
  restaurantName: string;
  branchName: string;
  branchPhone: string | null;
  orderNumber: string;
  orderType: string;
  tableLabel: string | null;
  currency: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  serviceChargeMinor: string;
  totalMinor: string;
  settledAt: string;
  payment: { method: string; status: string; amountMinor: string; currency: string; reference: string | null };
  lines: ReceiptLine[];
}

export function safeReceiptFilename(receiptNumber: string): string {
  return `${receiptNumber.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'receipt'}.html`;
}

export function escapeReceiptHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
