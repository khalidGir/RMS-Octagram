# Product Requirements Document: Octagram OS Restaurant Pilot

**Version:** 2.0 reconciliation baseline

**Status:** Approved for implementation; external tax/privacy/translation approvals remain launch gates

**Market:** Addis Ababa, Ethiopia
**Platforms:** Customer web; installable staff/owner PWA; desktop-capable platform administration

## 1. Product objective

Provide one auditable operational flow from customer order through payment confirmation, kitchen preparation, serving, inventory posting, shift reconciliation and business-day close. The pilot must work without payment gateways, OCR, delivery, reservations, fiscal hardware or offline financial mutations.

## 2. Users

- **Customer:** Accountless table-QR or public pickup ordering and secret-token tracking.
- **Owner:** Restaurant configuration, transfer verification, staff, inventory, all branches, shifts, day close and reports.
- **Manager:** Assigned-branch catalog, operations, inventory, staff scope and reports; no transfer verification or day-close authority.
- **Cashier:** POS, own active shift, cash confirmation and Ready-order completion.
- **Kitchen Staff:** Confirmed-ticket queue and Preparing/Ready transitions.
- **Waiter:** Ready-order completion and eligible physical-table clearance.
- **Super Admin:** Tenant provisioning, entitlements and explicit audited menu-only support mode.

Exact capabilities are normative in `RBAC.md`.

## 3. Customer entry and ordering

### Table QR

- `/o/{token}` resolves active tenant, branch and physical table server-side.
- Shows restaurant and `Table {label}` context.
- Offers configured dine-in or takeaway.
- Offers configured cash, bank transfer or Telebirr.
- Scanning or creating a draft never marks a table occupied.

### Public restaurant link

- `/r/{publicSlug}` resolves an active restaurant/branch without exposing internal IDs.
- Offers pickup pre-order only.
- Never offers table selection, dine-in, cash, delivery or reservation.
- Requires bank transfer or Telebirr proof before Owner verification and kitchen release.

### Cart and checkout

- Active branch menu, variants and modifiers are server authoritative.
- Customer may add bounded fulfillment notes.
- Server returns net/pre-VAT subtotal, configured VAT and Total payable in ETB.
- Service charge is zero and not shown.
- Client creates/reuses one idempotency key across retries.
- Customer accounts and loyalty-phone collection are absent from the pilot.

## 4. Payments

- Methods are Cash, Bank Transfer and Telebirr for the pilot.
- Transfer instructions are restaurant configured and snapshotted with order total/VAT.
- Proof accepts private JPEG/PNG/WebP up to 5 MB with checksum, content validation and scanning.
- Proof never confirms payment automatically.
- Only Owner verifies/rejects bank/Telebirr proof against the external account.
- Cashier or Owner confirms cash only inside their active shift.
- Successful confirmation atomically records payment/order state, inventory deduction, table session when applicable, audit and outbox events.
- Rejection never creates kitchen tickets or inventory deductions.

## 5. Kitchen, waiter and table sessions

- Only Confirmed orders reach KDS.
- Kitchen moves Confirmed/Queued -> Preparing -> Ready.
- Waiter, Cashier, Manager policy or Owner may complete a Ready order according to RBAC.
- First confirmed dine-in order opens or joins one active session for its table.
- A table remains Occupied after food completion.
- Waiter or Owner selects `Clear table` only after all linked orders are terminal and guests have left.
- Session open/join/clear is concurrency safe and auditable.

## 6. Cashier shifts

- One active shift per cashier/branch.
- Optional opening cash.
- Cash confirmation is attributed immutably to the current shift.
- Close calculates approved cash, expected drawer, counted cash and variance.
- Non-zero variance requires a reason.
- Closing produces an immutable printable/downloadable shift report.
- Later cash confirmations require a new shift.

## 7. Owner business-day close

- Branch uses configured timezone and local business-day cutoff.
- Preview includes open/closed shifts; expected/counted cash and variance; approved bank/Telebirr; recognized sales; rejected/cancelled/pending orders; inventory exceptions.
- Normal close is blocked by open shifts or pending payment/cash orders.
- Owner may close with documented exception; excluded items/totals remain visible.
- Close stores an immutable snapshot.
- Reopen requires Owner reason and audit history; it does not erase prior snapshot.

## 8. Catalog, VAT and inventory

- Owner/Manager manages categories, items, variants, modifiers, branch availability and recipes.
- Menu content supports English, Amharic and Arabic values with deterministic fallback.
- Tenant/branch VAT applicability/rate is versioned and confirmed during onboarding; no rate is hard-coded.
- Historical orders retain names, prices, tax and instruction snapshots.
- Recipe inventory deducts synchronously at confirmation and restores exact original batches on approved void.
- Strict non-negative stock is the pilot policy.
- Low-stock alerts trigger at or below configured threshold.

## 9. Platform entitlements and support

- Super Admin controls tenant feature entitlements; Owner controls permitted tenant/branch configuration.
- Disabling a feature blocks operations without deleting historical data.
- Super-admin menu assistance requires short-lived support mode with selected tenant and reason.
- Support mode permits menu/category/variant/modifier operations only.
- It cannot access payments, proofs, customers, orders, inventory, reports or staff.
- Every support mutation records actor, tenant, context reason and before/after values.

## 10. Localization and accessibility

- Required locales: English (`en`), Amharic (`am`) and Arabic (`ar`).
- English is fallback; Arabic uses RTL; English/Amharic use LTR.
- Domain/error codes remain stable and locale independent.
- Critical copy, validation, accessibility labels and printable reports are localized.
- Touch targets are at least 44 by 44 CSS pixels; keyboard/focus and non-color state cues are required.
- Native-speaker approval is required before production.

## 11. Connectivity and tracking

- Customer tracks through an opaque order token.
- Staff real-time connections are authenticated and tenant/branch/role scoped.
- Customer updates are order-token scoped or use 20-30 second polling fallback.
- Clients display persistent reconnecting/stale state and refetch authoritative state.
- Staff financial/order/inventory mutations are never silently queued offline.
- Under normal pilot connectivity, at least 95% of relevant state events should appear within three seconds.

## 12. Privacy and security

- Every tenant/branch read and write is server scoped; user-supplied tenant identity is never trusted.
- Proof is private, access-audited and served through short-lived authorization.
- Tokens, proofs, account values and phone numbers never enter logs/analytics.
- Proof retention/deletion and hosting obligations require approved policy before production data.
- Loyalty phone storage remains disabled until separately approved.
- Payment, inventory, shift and day-close mutations are versioned/idempotent where applicable and transactionally consistent.

## 13. Reporting

- Revenue from approved payments only, by date/branch/method.
- Order count, average value, cancellations and voids.
- Best sellers, peak local hours and inventory consumption.
- Shift and business-day snapshots remain operational records distinct from live analytics.
- Money serializes exactly; branch-local boundaries convert explicitly to UTC.

## 14. Explicit exclusions

- Payment gateway/provider API, OCR and automatic verification.
- Delivery, reservations, promotions/coupons and loyalty rewards.
- Fiscal printing, accounting integration, procurement and cross-branch stock transfer.
- Native mobile apps and offline financial/order mutation sync.
- Negative-stock override during the pilot.

## 15. Success and release gates

- At least 95% of confirmed orders appear to authorized kitchen views within three seconds under normal pilot connectivity.
- Duplicate confirmed orders/payments/inventory postings from retry: zero.
- Cross-tenant data incidents: zero.
- Every operated cash shift closes with an immutable report.
- Day-close totals reconcile to controlled fixtures and pilot ground truth.
- Backup/restore, clean migrations, security hardening, OpenAPI freeze and critical Playwright journeys pass.
- `UX_ACCEPTANCE_CHECKLIST.md` and `REQUIREMENTS_TRACEABILITY.md` have no unresolved launch-blocking item.

## 16. Supporting normative documents

- `PRODUCT_V0_2_DECISIONS.md`
- `PRODUCT_V0_2_RECONCILIATION.md`
- `RBAC.md`
- `WORKFLOWS.md`
- `DATABASE_SCHEMA.md`
- `API_SPEC.md`
- `IMPLEMENTATION_PLAN.md`
- `UX_ACCEPTANCE_CHECKLIST.md`
- `REQUIREMENTS_TRACEABILITY.md`
