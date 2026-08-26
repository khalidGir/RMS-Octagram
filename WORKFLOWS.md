# Core Product Workflows

## 1. State Machines

### 1.1 Order state

```text
DRAFT
  -> PENDING_PAYMENT
  -> PENDING_CONFIRMATION
  -> CONFIRMED
  -> IN_PROGRESS
  -> READY
  -> COMPLETED

Any permitted active state -> CANCELLED or VOIDED according to policy.
```

- `CANCELLED` is used before operational confirmation where no completed financial reversal is needed.
- `VOIDED` is used after confirmation and requires an audit reason plus payment/inventory consequences.
- State transitions are server controlled and append to `order_status_history`.

### 1.2 Manual payment state

```text
PENDING
  -> PENDING_VERIFICATION
  -> APPROVED
  -> REJECTED -> PENDING_VERIFICATION (resubmission)

PENDING or PENDING_VERIFICATION -> CANCELLED
APPROVED -> REFUNDED (future/manual accounting workflow)
```

### 1.3 Kitchen ticket state

```text
QUEUED -> IN_PROGRESS -> READY -> COMPLETED
                     READY -> RECALLED -> IN_PROGRESS
Any active state -> CANCELLED after an authorized order void
```

## 2. Table QR Ordering

1. Manager creates or rotates a QR token for a branch table.
2. Customer scans the QR code and the API resolves its tenant, branch, table, and availability.
3. The system reuses an open dining session or creates one according to branch policy.
4. Customer loads only the branch's active, available menu and server-provided prices.
5. Customer submits items with an idempotency key.
6. API validates token, feature flag, item availability, modifiers, and totals.
7. API creates the order and immutable line snapshots.
8. If prepayment is required, order enters `PENDING_PAYMENT`; otherwise it enters `PENDING_CONFIRMATION` for staff approval.
9. After payment/approval policy succeeds, the order becomes `CONFIRMED` and KDS tickets are created.
10. Customer tracks status through an opaque order-tracking token.

Failure behavior:

- Expired/revoked QR: show a safe message and instruct the customer to ask staff.
- Price changed: return the recalculated cart and require customer confirmation.
- Item unavailable: identify affected lines without creating a partial order.
- Duplicate submission: return the original response using the idempotency record.

## 3. Remote Pickup Ordering

1. Customer selects a public branch.
2. API returns branch hours, pickup policy, available slots, menu, and payment methods.
3. Customer enters required name, phone, pickup time, and items.
4. API validates the pickup slot and calculates totals.
5. Order is created as `PENDING_PAYMENT` or `PENDING_CONFIRMATION`.
6. Customer completes the selected payment workflow.
7. Confirmed order routes to KDS with pickup time and contact-safe display information.
8. Staff progresses the order; customer tracking updates in real time or through polling.

## 4. Manual Transfer and Proof Review

1. Customer selects manual transfer.
2. API returns branch-approved payment instructions and creates a `PENDING` payment for the exact order balance.
3. Client requests a presigned upload using order tracking context.
4. API validates file metadata and creates a pending media record.
5. Client uploads directly to private S3 and calls finalize with checksum/reference data.
6. API verifies object metadata and attaches the proof; payment becomes `PENDING_VERIFICATION`.
7. POS receives `payment.submitted` and displays the review queue.
8. Cashier opens an expiring proof URL and compares amount/reference in the external financial account according to restaurant policy.
9. Cashier chooses approve or reject.
10. Approval transaction changes payment to `APPROVED`, confirms the order, applies inventory deductions/reservations, creates audit/history/outbox records, and creates KDS tickets.
11. Rejection records a required reason, changes payment to `REJECTED`, and notifies the customer that resubmission is allowed.

Race controls:

- Approval requires the expected payment and order versions.
- Approval endpoint requires an idempotency key.
- A unique constraint or guarded transaction prevents two approved payments from exceeding the payable balance unless split payments are explicitly enabled.
- Duplicate finalize/approve calls return the existing result.

## 5. Cashier POS Order

1. Cashier selects the active branch and starts a new POS or table order.
2. Cashier adds items; API provides authoritative prices and availability.
3. Draft may be edited until confirmation.
4. Cashier selects cash, manual transfer, or allowed pay-later policy.
5. For cash, cashier records received amount; API calculates change for display but stores the applied payment amount.
6. Transaction approves the payment and confirms the order.
7. KDS tickets appear immediately and POS shows a printable receipt view.

The MVP receipt view is browser printable. Hardware printer integration is deferred.

## 6. Kitchen Workflow

1. Confirmed order generates one ticket per kitchen station containing relevant lines.
2. KDS joins tenant/branch/station WebSocket rooms and fetches the current queue.
3. Staff bumps a queued ticket to `IN_PROGRESS`.
4. When all required work is ready, tickets become `READY`; the order becomes `READY` when all non-cancelled tickets are ready.
5. Staff/POS marks fulfilled order `COMPLETED`.
6. Recall requires a reason and returns a ready ticket to active work.
7. Every command uses optimistic versioning and idempotency.
8. If real-time transport fails, KDS polls and reconciles from authoritative queue state.

## 7. Inventory Deduction

Initial MVP rule: deduct mapped recipe quantities when the order becomes `CONFIRMED`.

1. Load active recipe version for every order-line variant.
2. Lock relevant inventory balances/batches in deterministic order.
3. Apply FIFO by received/expiry policy configured for the item.
4. Append `DEDUCT` movements tied to the order.
5. Update batch balances in the same transaction.
6. Emit low-stock events after commit.
7. If an authorized confirmed order is voided, append `VOID_RESTORE` movements; never delete the original deduction.

Insufficient inventory policy for MVP:

- Customer submission fails before confirmation if strict stock control is enabled.
- Manager may configure warning-only behavior where operational reality requires it.
- Negative stock is never silently introduced.

## 8. Split and Merge Bills

Implement after the basic order flow is stable.

- Split creates new orders using selected quantities and records `order_relations`.
- Already paid lines cannot move without an explicit payment reallocation/refund design.
- Merge is allowed only for compatible open dine-in orders in the same tenant, branch, currency, and session/table context.
- Totals and histories are recalculated server-side in one transaction.
- Never rewrite or delete historical orders after completion.

For the earliest MVP increment, restrict split/merge to unpaid, unconfirmed orders if schedule is constrained.

## 9. Tenant and Branch Provisioning

1. Super Admin creates tenant with default ETB currency and Addis Ababa timezone.
2. System creates first Owner invitation.
3. Owner creates one or more branches.
4. Owner configures payment instructions, feature toggles, table layout, menu, stations, and inventory policy.
5. Owner invites staff and assigns branch access.
6. Readiness checklist blocks public ordering until required configuration exists.
7. Activation and configuration changes are audited.

## 10. End-of-Day Reporting

1. User selects branch or authorized tenant-wide scope and a local date range.
2. API converts branch-local day boundaries to UTC.
3. Reports use approved payments and non-voided order data.
4. Revenue distinguishes payment methods and pending/rejected transfers.
5. Best sellers aggregate immutable order-line snapshots.
6. Peak hours use branch-local order-confirmation timestamps.
7. Inventory consumption uses the movement ledger.
8. UI labels data freshness and report scope.

## 11. Required Failure and Recovery UX

- Always show online/offline and reconnecting state on POS and KDS.
- Disable confirmation/payment/status mutations when the server cannot acknowledge them.
- Preserve an unsent cart locally, but revalidate it before submission.
- On `409 Conflict`, refetch the authoritative resource and explain that another staff member changed it.
- On expired customer tracking access, do not reveal whether another order exists.
- Provide retry actions for safe failures and avoid duplicate financial actions through idempotency.

## 12. Product v0.2 Ordering Contexts

### 12.1 Table QR

1. Customer opens `/o/{token}`; server resolves active tenant, branch and table.
2. UI identifies `Table {label}` and offers configured DINE_IN or TAKEAWAY.
3. Customer may choose cash, bank transfer or Telebirr according to effective feature/payment configuration.
4. Scanning and draft creation do not change table occupancy.
5. Cash submission waits for cashier confirmation during an active shift; transfer waits for Owner verification.
6. First successful dine-in confirmation atomically opens or joins the one active table session.
7. Kitchen receives the confirmed order; completion does not clear the session.
8. Waiter/Owner clears after guests leave and all session orders are terminal.

### 12.2 Public pickup

1. Customer opens `/r/{publicSlug}`; server resolves an active restaurant/branch.
2. UI identifies `Pickup pre-order`; no table, dine-in, delivery or reservation action exists.
3. Customer selects a pickup slot and pays by bank transfer or Telebirr with proof.
4. Cash is rejected at UI and API boundaries.
5. Owner verifies against the external account; only then does the order reach kitchen.
6. Tracking shows pending review, confirmed, preparing, ready and completed states.

## 13. Product v0.2 Transfer Review

1. Customer selects explicit bank transfer or Telebirr instructions and receives exact subtotal/VAT/total.
2. Order/payment snapshots retain the instruction version and tax calculation.
3. Customer uploads a private scanned image.
4. Owner-only queue shows method, order, total, age, instruction snapshot and expiring proof access.
5. Owner checks the real external account; screenshot alone is never represented as proof of settlement.
6. Verify atomically approves payment, confirms order, posts inventory once, opens/joins a dine-in session when applicable, audits and writes outbox events.
7. Reject requires an internal reason and produces safe localized tracking copy.
8. Manager, Cashier, Waiter, Kitchen and Super Admin direct calls are denied.

## 14. Cashier Shift

1. Cashier selects assigned branch and opens a shift with optional opening cash.
2. Database enforces one active shift for that cashier/branch.
3. Cash confirmation derives and snapshots the active shift; the client cannot choose another shift.
4. Shift view calculates approved cash orders, expected drawer, cancellations/void metadata and elapsed time.
5. Cashier enters counted cash at close.
6. Non-zero variance requires a reason; close is versioned/idempotent.
7. Close persists an immutable report and prevents later cash attribution.
8. Further cash confirmation requires a new shift.

Failure behavior:

- No active shift: cash confirmation remains unchanged and returns `SHIFT_REQUIRED`.
- Concurrent close/payment: transaction/locking produces one authoritative result without losing payment attribution.
- Stale close: return conflict and refreshed summary.

## 15. Business-Day Close

1. Owner opens the branch-local business date preview using configured timezone/cutoff.
2. Preview shows open/closed shifts, cash expected/counted/variance, approved bank/Telebirr, recognized sales, rejected/cancelled/pending and inventory exceptions.
3. Normal close is blocked by open shifts or pending payment/cash orders and links to them.
4. Owner resolves blockers or selects close-with-exception.
5. Exception close lists excluded records/totals and requires a reason.
6. Close stores an immutable snapshot with effective UTC/local boundaries.
7. Reopen requires Owner reason and appends audit/history; prior snapshot is preserved.

## 16. Waiter and Table Clearance

1. Waiter opens assigned-branch Ready/table projection.
2. Waiter completes/serves a Ready order.
3. Table remains Occupied while its session is open.
4. `Clear table` appears only when every linked order is completed/cancelled.
5. Confirmation reminds staff to act only after guests physically leave.
6. Clear closes the session, records actor/time and emits a scoped invalidation.

## 17. Super-Admin Menu Support

1. Super Admin selects an active tenant, provides reason and enters short-lived support context.
2. UI displays persistent `Editing menu for {Restaurant}` banner.
3. Only catalog/category/variant/modifier reads and mutations are exposed.
4. Server binds every mutation to the selected tenant/context and records before/after audit.
5. Payments, proof, customers, orders, inventory, reports and staff routes deny the support context.
6. Exit/revocation/expiry clears the target and requires re-entry for further edits.

## 18. Localization Workflow

1. Public user selects English, Amharic or Arabic; preference persists locally.
2. Staff preference persists on their account.
3. Content resolves requested locale, then tenant default, English and base value.
4. Arabic switches document direction to RTL while numeric/account/token fragments remain readable.
5. Server domain values remain locale independent; API returns stable codes and the frontend localizes them.
6. Printable shift/day reports use requested locale but preserve exact ETB values and timestamps.
