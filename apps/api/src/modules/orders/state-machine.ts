/**
 * Order state machine.
 *
 * 3A allowed transitions (no confirmation side effects):
 * - DRAFT -> PENDING_PAYMENT | PENDING_CONFIRMATION | CANCELLED
 * - PENDING_PAYMENT -> CANCELLED
 * - PENDING_CONFIRMATION -> CANCELLED
 *
 * Full transitions (defined but not all implemented until 3C):
 * - PENDING_PAYMENT -> CONFIRMED (via OrderConfirmationService)
 * - PENDING_CONFIRMATION -> CONFIRMED (via OrderConfirmationService)
 * - CONFIRMED -> IN_PROGRESS
 * - IN_PROGRESS -> READY
 * - READY -> COMPLETED
 *
 * VOIDED transitions are not implemented until full compensation exists.
 */

// 3A transitions: allowed before confirmation coordinator exists
const ORDER_TRANSITIONS_3A: Record<string, string[]> = {
  DRAFT: ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CANCELLED'],
  PENDING_PAYMENT: ['CANCELLED'],
  PENDING_CONFIRMATION: ['CANCELLED'],
};

// Full transitions: used by OrderConfirmationService and kitchen operations
const ORDER_TRANSITIONS_FULL: Record<string, string[]> = {
  DRAFT: ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY'],
  READY: ['COMPLETED'],
};

/**
 * Check if a transition is allowed in 3A mode.
 */
export function canTransition3A(from: string, to: string): boolean {
  return ORDER_TRANSITIONS_3A[from]?.includes(to) ?? false;
}

/**
 * Check if a transition is allowed in full mode.
 */
export function canTransitionFull(from: string, to: string): boolean {
  return ORDER_TRANSITIONS_FULL[from]?.includes(to) ?? false;
}

/**
 * Get allowed next states for a given current state (3A mode).
 */
export function getAllowedTransitions3A(currentStatus: string): string[] {
  return ORDER_TRANSITIONS_3A[currentStatus] ?? [];
}

/**
 * Get allowed next states for a given current state (full mode).
 */
export function getAllowedTransitionsFull(currentStatus: string): string[] {
  return ORDER_TRANSITIONS_FULL[currentStatus] ?? [];
}

/**
 * Determine initial order status based on payment policy.
 */
export function getInitialStatus(
  paymentPolicy: string,
): 'PENDING_PAYMENT' | 'PENDING_CONFIRMATION' {
  switch (paymentPolicy) {
    case 'PAY_LATER_ALLOWED':
    case 'STAFF_CONFIRMATION_REQUIRED':
      return 'PENDING_CONFIRMATION';
    case 'PREPAY_REQUIRED':
    default:
      return 'PENDING_PAYMENT';
  }
}
