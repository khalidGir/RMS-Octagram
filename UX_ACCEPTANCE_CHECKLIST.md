# Product v0.2 UX Acceptance Checklist

Use this checklist for design review, component implementation, Playwright coverage and pilot usability sessions. A checked item requires observable evidence; a design annotation alone is not completion.

## Global experience

- [ ] Customer works without account or app installation.
- [ ] Staff surfaces are installable PWAs with role-specific navigation.
- [ ] Customer mobile portrait, staff tablet landscape, owner mobile and super-admin desktop layouts are verified.
- [ ] Interactive targets are at least 44 by 44 CSS pixels.
- [ ] Focus order, visible focus, keyboard operation and screen-reader names are verified.
- [ ] State is communicated with text/icon in addition to color.
- [ ] Default, loading, slow, empty, validation, server-error, conflict, disconnected, stale and permission-denied states exist.
- [ ] Unsafe actions are disabled while unresolved or offline; no false-success toast appears before server confirmation.
- [ ] `409` refreshes authoritative state and explains that another user changed the record.
- [ ] Correlation/request IDs appear only where useful for support and never expose internals.

## Localization

- [ ] English, Amharic and Arabic are selectable at public entry.
- [ ] Authenticated locale preference persists per user.
- [ ] Public locale persists locally without requiring an account.
- [ ] English fallback works for missing translated content.
- [ ] Arabic uses RTL layout while account numbers, amounts, phone numbers and tokens retain readable direction.
- [ ] Amharic long labels do not truncate critical actions or totals.
- [ ] Dates, times, plurals and ETB formatting are locale aware.
- [ ] Production copy is reviewed by native speakers.

## UX-01: QR and public menu entry

- [ ] `/o/{token}` visibly identifies restaurant and `Table {label}`.
- [ ] `/r/{publicSlug}` visibly says `Pickup pre-order`.
- [ ] Public entry never offers table, dine-in, delivery, reservation or cash.
- [ ] Table QR permits only configured dine-in/takeaway and payment choices.
- [ ] Invalid/revoked context shows the safe unavailable message without internal IDs.
- [ ] Category, item and cart navigation remains usable with one hand.

## UX-02: Item, cart and totals

- [ ] Modifier requirements and min/max errors are explained inline.
- [ ] Server price/availability changes identify affected lines before retry.
- [ ] Cart shows `Subtotal (before VAT)`, `VAT` and `Total payable` in ETB.
- [ ] No service-charge row or configuration is visible.
- [ ] Submit disables while pending and reuses the original idempotency key on retry.
- [ ] Notes are bounded and preserve translated/user-generated text safely.
- [ ] Loyalty consent and phone collection are absent until separately activated by an approved decision.

## UX-03: Bank/Telebirr proof

- [ ] Bank and Telebirr instructions are clearly distinguished and copyable.
- [ ] Manual-verification copy explains that kitchen release waits for owner review.
- [ ] JPEG, PNG and WebP up to 5 MB are accepted; other files have recoverable errors.
- [ ] Preview/replacement, progress and retry states exist.
- [ ] Private-data reminder appears before upload.
- [ ] Proof or account values never enter analytics events.

## UX-04: Customer tracking

- [ ] Shows order number, type/table, total, payment method and status timeline.
- [ ] Cash copy says `Awaiting cashier confirmation`.
- [ ] Transfer copy says `Awaiting manual payment verification`.
- [ ] Rejection copy is safe and instructs the customer to ask staff.
- [ ] Confirmed, Preparing, Ready, Completed and Cancelled are localized.
- [ ] Reconnecting/stale state remains visible until authoritative refresh.
- [ ] Invalid/expired tracking token reveals no order existence or detail.

## UX-05: Cashier

- [ ] Active-shift state and open-shift CTA are prominent.
- [ ] Cash queue shows order number, age, context, lines, notes and total.
- [ ] Confirm cash is unavailable without an active shift.
- [ ] Deliberate confirmation repeats order number and exact total.
- [ ] Cashier sees no bank/Telebirr proof-review controls.
- [ ] Cashier can complete a Ready order but cannot clear a table.

## UX-06: Kitchen

- [ ] Landscape New, Preparing and Ready organization is glanceable.
- [ ] Cards prioritize elapsed time, context, items, modifiers and notes.
- [ ] Only valid next transition is shown.
- [ ] New order uses visual and optional sound cues, never sound alone.
- [ ] Concurrent update explains refresh and restores authoritative queue.

## UX-07: Waiter

- [ ] Ready orders are prioritized over the table list.
- [ ] Tables show staff-managed Available/Occupied states.
- [ ] Pickup orders are clearly distinguished from table orders.
- [ ] Waiter can complete/serve Ready orders only.
- [ ] `Clear table` is available only after every session order is terminal.
- [ ] Confirmation says to clear only after guests have physically left.
- [ ] No menu, pricing, payment, inventory or staff controls are present.

## UX-08: Owner payment review

- [ ] Queue shows method, order, total, age and instruction snapshot.
- [ ] Proof access is private, expiring and clearly separate from external account verification.
- [ ] Verify dialog states that confirmation releases kitchen and posts stock once.
- [ ] Rejection requires a reason.
- [ ] Concurrent/late decision refreshes current state without duplicate action.
- [ ] Only Owner can see or operate this surface.

## UX-09: Cashier shift close

- [ ] Shows opening cash, cash-order count, confirmed cash, expected drawer and elapsed time.
- [ ] Counted cash starts empty and accepts valid ETB input.
- [ ] Non-zero variance requires a concise reason.
- [ ] Close confirmation explains that later cash confirmations require a new shift.
- [ ] Completed shift report is immutable, printable and downloadable.

## UX-10: Owner business-day close

- [ ] Shows open/closed shifts, expected/counted cash, variance, verified bank, verified Telebirr, recognized sales, rejected/cancelled, pending and inventory exceptions.
- [ ] Normal close links to unresolved open shifts and pending payments.
- [ ] Close-with-exception lists excluded items/totals and requires reason.
- [ ] Reopen requires reason and displays audit history.
- [ ] Closed snapshot does not silently change after later operations.

## UX-11: Owner configuration

- [ ] Mobile-first navigation covers Dashboard, Orders/Payments, Menu, Inventory, Tables, Team and Reports.
- [ ] VAT applicability/rate and business-day boundary are clear and permission protected.
- [ ] Bank/Telebirr values are masked in lists and safely copyable/editable.
- [ ] Instruction changes affect new orders only.
- [ ] QR regeneration warns that old prints stop working.
- [ ] Stock adjustments/reversals require a reason.
- [ ] Menu content supports English, Amharic and Arabic values with fallback preview.

## UX-12: Super-admin menu support

- [ ] Entering support mode requires tenant selection and reason.
- [ ] Persistent banner names the restaurant being edited.
- [ ] Only category/item/variant/modifier operations are visible.
- [ ] Payment, proof, customer, order, inventory, report and staff access is absent and server denied.
- [ ] Leaving support mode clears the target context.
- [ ] Every change exposes appropriate audit evidence.

## Pilot release blockers

- [ ] Payment state is unambiguous to customers and staff.
- [ ] No duplicate order/payment/stock action occurs during retries or concurrency.
- [ ] No unauthorized role can perform or see a protected action.
- [ ] No payment proof, phone, token or cross-tenant data leaks.
- [ ] Shift/day totals reconcile against controlled fixtures and observed pilot ground truth.
- [ ] Table state never becomes Available merely because food was completed.
- [ ] Disconnection never appears as confirmed success.
- [ ] Native-language review and pilot task testing have no unresolved critical finding.
