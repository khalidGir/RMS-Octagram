# Product v0.2 Requirement Traceability

**Baseline:** Backend checkpoint `9b721e8`, 229 unit plus 274 E2E tests (503 total).  
**Rule:** A requirement is Complete only when implementation, authorization/isolation tests, database-backed acceptance tests, OpenAPI and relevant UX evidence exist.

| ID | Requirement | Baseline state | Target implementation | Required automated evidence | UX/research evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-001 | Tenant identity/authorization | Partial-complete | Auth/Tenancy plus Waiter and support context | Role matrix; cross-tenant/branch; stale role; support escape denial | Unauthorized controls absent; safe denial |
| REQ-002 | QR/public entry/table sessions | Partial | Tables + Orders session lifecycle + public slug | Revoked token; slug isolation; concurrent session open; premature clear denial | QR/public distinction; occupied/clear tasks |
| REQ-003 | Menu/VAT/support editing | Partial | Catalog + TaxConfig + SupportContext | Exact VAT math; version snapshots; support allowlist/isolation | Three-language menu; totals comprehension; support banner |
| REQ-004 | Guest order/minimal data | Partial-complete | Orders; loyalty disabled | Order succeeds without phone/consent; bounded notes | Accountless checkout; no coercive field |
| REQ-005 | Duplicate-safe creation | Complete; retain | Orders/Idempotency | Same-key replay; changed-hash conflict; concurrent single row | Pending/timeout/retry messaging |
| REQ-006 | Instructions/proof | Partial-complete | Payments explicit bank/Telebirr + route policy | MIME/size/checksum/scan; snapshot; public cash denial | Copy/upload/recovery/manual-review clarity |
| REQ-007 | Review/confirmation | Modify | Payments + Shifts + Inventory transaction | Owner-only transfer; active-shift cash; concurrent decision; rollback | Owner/cashier separation; deliberate confirm/reject |
| REQ-008 | Kitchen/waiter | Partial | Kitchen + Waiter operations | Illegal transition; role denial; ready/completed propagation | Tablet queue; ready serving; reconnect |
| REQ-009 | Cashier shifts | New | Shifts module | Single active; attribution; exact totals; variance reason; immutable close; concurrency | Open/close/count/print task |
| REQ-010 | Business-day close | New | BusinessDay module | Boundary; blockers; exact snapshot; exception; concurrent close; audited reopen | Owner reconciliation task under ten seconds |
| REQ-011 | Inventory | Complete; retain | Inventory + day-close exception read | FIFO; insufficient rollback; duplicate; exact restore; threshold | Recipe setup and deduction credibility |
| REQ-012 | Real-time/interruption | Partial | Authenticated WS + token tracking/polling | Room isolation; invalid token; reconnect/refetch; latency metric | Persistent stale state; no offline false success |
| REQ-013 | Owner/platform management | Partial | Tenancy/Platform + SupportContext | Tenant disable; owner-only settings; support audit and allowlist | Mobile configuration; support mode usability |
| NFR-001 | Performance | Partial | Metrics/load gates | p95 state delivery <=3s; day close <10s | Peak-service observation |
| NFR-002 | Interruption honesty | Partial | Query/reconnect architecture | Forced disconnect and authoritative recovery | Staff explains current stale/action state correctly |
| NFR-003 | Accessibility/i18n | New frontend gate | i18n/design system | Locale routing/component tests; axe/keyboard checks | Native review; RTL and long Amharic sessions |
| NFR-004 | Security/privacy | Hardening in progress | Security/Media/Support | AuthZ matrix; rate limits; redaction; private proof; upload abuse | No sensitive content in UI/analytics |
| NFR-005 | Compliance | External gate | Retention/privacy operations | Deletion job/access audit tests after policy approval | Approved notice and participant consent |
| NFR-006 | Reliability | Strong baseline | Transactions/backups | Rollback, idempotency, fresh migration, backup/restore | Reconciliation against pilot ground truth |

## Required critical journeys

| Journey | Automated path | Pass condition |
| :--- | :--- | :--- |
| J-01 Table cash | QR -> localized menu -> dine-in -> cash pending -> active-shift confirmation -> table occupied -> KDS -> served -> clear | One order/payment/deduction; table clears only at final action |
| J-02 Table transfer | QR -> bank/Telebirr proof -> owner review -> KDS -> tracking | Cashier/manager cannot review; proof remains private |
| J-03 Public pickup | Public slug -> pickup -> bank/Telebirr proof -> owner review -> KDS -> Ready | No table/dine-in/delivery/cash controls or API bypass |
| J-04 Payment rejection | Proof -> owner rejection reason -> customer tracking | No kitchen ticket or inventory deduction |
| J-05 Shift reconciliation | Open -> confirm multiple cash orders -> count -> variance reason -> close | Immutable report equals exact payment attribution |
| J-06 Day close | Multiple shifts/methods -> blocker resolution -> close -> reopen reason | Immutable exact snapshot; pending excluded visibly |
| J-07 Table concurrency | Two confirmed QR orders on one table -> complete -> clear | One session; clear denied until all terminal |
| J-08 Support menu | Enter support reason -> edit selected tenant menu -> exit -> attempt payment access | Menu edit audited; operational access denied |
| J-09 Connectivity | Disconnect during mutation and KDS/tracking updates -> reconnect | No silent queue/false success; authoritative refetch |
| J-10 Localization | Repeat customer/staff critical paths in en/am/ar | No clipping, broken RTL, untranslated critical copy or inaccessible controls |

## Release accounting

- Existing test count is a baseline, not a permanent expected number; changed product rules may require replacing obsolete expectations.
- Every replaced test must cite the superseding decision and preserve security/concurrency strength.
- No phase report may combine skipped tests with passing totals or label infrastructure failures as unrelated.
- The final report lists unit, database E2E, Playwright, accessibility, migration, load and restore results separately.
