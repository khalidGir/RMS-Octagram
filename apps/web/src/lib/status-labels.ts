import type { MessageKey } from '@/components/locale-provider';

export const orderStatusKeys: Record<string, MessageKey> = {
  DRAFT: 'status.orderDraft',
  PENDING_PAYMENT: 'status.orderPendingPayment',
  PENDING_CONFIRMATION: 'status.orderPendingConfirmation',
  CONFIRMED: 'status.orderConfirmed',
  IN_PROGRESS: 'status.orderInProgress',
  READY: 'status.orderReady',
  COMPLETED: 'status.orderCompleted',
  CANCELLED: 'status.orderCancelled',
  VOIDED: 'status.orderVoided',
};

export const kdsStatusKeys: Record<string, MessageKey> = {
  QUEUED: 'status.kdsQueued',
  IN_PROGRESS: 'status.kdsInProgress',
  READY: 'status.kdsReady',
  COMPLETED: 'status.kdsCompleted',
  CANCELLED: 'status.kdsCancelled',
};

export const paymentMethodKeys: Record<string, MessageKey> = {
  CASH: 'status.methodCash',
  BANK_TRANSFER: 'status.methodBankTransfer',
  TELEBIRR: 'status.methodTelebirr',
  MANUAL_TRANSFER: 'status.methodManualTransfer',
};

export const orderTypeKeys: Record<string, MessageKey> = {
  DINE_IN: 'status.orderTypeDineIn',
  TAKEAWAY: 'status.orderTypeTakeaway',
  PICKUP: 'status.orderTypePickup',
};

export const tenantStatusKeys: Record<string, MessageKey> = {
  TRIAL: 'status.tenantTrial',
  ACTIVE: 'status.tenantActive',
  SUSPENDED: 'status.tenantSuspended',
  CANCELLED: 'status.tenantCancelled',
};

export const membershipStatusKeys: Record<string, MessageKey> = {
  INVITED: 'status.memberInvited',
  ACTIVE: 'status.memberActive',
  SUSPENDED: 'status.memberSuspended',
  REVOKED: 'status.memberRevoked',
};

export function labelFor(
  map: Record<string, MessageKey>,
  raw: string,
  tr: (key: MessageKey) => string,
): string {
  const key = map[raw];
  return key ? tr(key) : raw.replaceAll('_', ' ');
}
