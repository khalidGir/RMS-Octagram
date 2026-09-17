# Frontend verified takeover progress

## Evidence and scope

The persistent goal is the complete integrated RMS MVP and staging preparation. This record is partial evidence, not release approval. Existing OpenCode edits have been preserved; passing mocked hook tests are not live-browser proof.

## Live queue recovery — 2026-09-17

- Replaced broken custom KDS reconnect timers with Socket.IO bounded transport recovery (10 attempts, 1–16 second delays). Transport recovery rejoins rooms and calls the authoritative reconciliation callback. Deliberate server disconnects require explicit retry; exhaustion and room errors remain visible.
- Socket cleanup removes both socket and dedicated-manager listeners. Missing credentials/context disconnect the old connection.
- Added listeners for actual fulfillment, Expo, assignment, and service-notification event names. Shared fulfillment reconciliation rejoins relevant service/personal or Expo rooms and invalidates HTTP queues for the current tenant/branch. Expo and waiter screens now use it; existing polling remains enabled.
- Removed the notification adapter's catch-all fabricated empty response. Errors now reach the existing notification error/retry UI.
- Service/Expo query keys include tenant and branch; query execution waits for credentials/context, and mutation invalidations use the same scoped keys.
- Fixed Expo conditional hook ordering and replaced waiter's hardcoded Online claim with observed socket state/retry control.
- Targeted hook suites: **11 tests passed** (4 socket, 3 Expo contract, 2 notification/context, 2 reconciliation). Final frontend typecheck, targeted lint including the new test file, and diff whitespace checks passed. No complete production build or live-browser gate is claimed.

## Important remaining work

- Backend socket guard requires real tenant/branch/station and entitlement revalidation; current Owner bypass does not prove branch tenant ownership. Do not treat these screens as securely integrated yet.
- Durable delivery handlers remain missing for several outbox event types. Direct service broadcasts and polling do not close reliable-delivery requirements.
- Notification API contract is not yet implemented/verified; real errors are intentionally visible rather than disguised as an empty queue.
- Tenant/profile/branch context unification, idempotency action lifetimes, authorization states, offline mutation guards, all role workflows, theme/localization/a11y/device tests, full quality gates, and staging remain incomplete.

Related cash permission evidence: Cash-shift page/navigation regression suites passed 12 tests. Financial backend authorization is independent and mandatory.
