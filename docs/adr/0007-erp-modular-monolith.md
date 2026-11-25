# ADR-0007: ERP "Campus Shop & Membership Platform" as a modular-monolith module

Status: Accepted
Date: 2026-11-25
Source of truth: `upload/Campus Shop & Membership Platform - System Design.pdf` (24-page system design)

## Context

The organization needs a campus shop + membership platform with payments,
auto-debit memberships, and a double-entry ledger. The design PDF specifies a
**modular monolith ERP core on TiDB** with two split-out services (Webhook
Ingress, Payment Worker), strict module boundaries (own tables, typed
interfaces, no cross-module joins), a transactional outbox/inbox, six
debounce/idempotency layers, and PayMongo behind a `PaymentProvider` port.

This codebase is a Next.js 16 single-route campus-org site with Prisma 7
(SQLite dev / Postgres prod), custom cookie-session auth, and a full security
architecture (docs/SECURITY.md).

## Decision

Adopt the ERP as an **additive module inside this application**
(`src/modules/erp/`) rather than a separate deployment, preserving the PDF's
architecture invariants that matter for correctness and team scaling:

1. **Eleven modules with prefixed tables** (`iam_ cat_ inv_ ord_ mem_ bil_
   pay_ gl_ sys_ api_`) — enforced by a boundary test, a composition root
   (`container.ts`) as the only cross-module importer, and a public registry
   (`index.ts`) as the only import surface for routes.
2. **Transactional outbox + inbox** (`sys_outbox`, `sys_inbox`) — events
   commit in the same transaction as the state change; delivery is
   at-least-once; consumers dedupe.
3. **Six-layer charge-once discipline** — API idempotency keys, DB invariants
   (`uq_one_in_flight` via the nullable `active_slot` trick,
   `uq_one_invoice_per_period`, `uq_provider_idem`, `uq_event`), provider
   idempotency keys stored before the call, signed-webhook settlement.
4. **Two-transaction money path** (Txn A reserve → provider call outside any
   transaction → Txn B settle on webhook).
5. **PaymentProvider port + MockPaymentProvider** — PayMongo later, swappable.
6. **Webhook Ingress pattern** — `POST /api/erp/webhooks/payment` verifies +
   stores + acknowledges fast (no business logic), CSRF-exempt like
   `/api/webhook/publish` because its authorization model is the HMAC
   signature.
7. **Worker as an extraction-ready function** — `runWorkerTick()` bundles the
   scheduler, outbox relay, provider delivery, settlement, and sweepers;
   admin-triggered today (`POST /api/erp/worker/tick`), a standalone process
   in phase 2 without code changes.

### Stack adaptations from the PDF (documented deviations)

| PDF | This codebase | Why |
|---|---|---|
| TiDB (MySQL protocol), `BIGINT AUTO_RANDOM` PKs | Prisma cuid/uuid PKs + ULID `public_id` on both SQLite (dev) and Postgres (prod) | The app's existing dual-schema pattern (ADR-0002). ULID public ids keep the client-facing contract identical to the blueprint. |
| `BIGINT` centavos | `Int` centavos (via `shared/money.ts` guards) | JSON-safe serialization; 2^31 centavos ≈ ₱21.4M fits campus scale. The integer-only rule (never floats) is preserved. |
| NestJS modules + DI | Next.js route handlers over a composition root with constructor-injected interfaces | One deployable, same boundary discipline, enforced by tests instead of a framework. |
| Redis debounce (layer 2) | Route rate limits today; Redis deferred to phase 2 | Layers 3–6 are the correctness guards; layers 1–2 reduce noise. No new infra in the skeleton. |
| BullMQ workers | `runWorkerTick()` behind an admin endpoint | Same job semantics (conditional claims, leases, dedupe); extraction path unchanged. |
| Plain SQL for money paths | ONE parameterized raw SQL per counter update (inv_stock reserve/commit/release) | The blueprint explicitly prefers visible conditional updates for counters; Prisma's filter API cannot express `reserved <= on_hand - qty`. Values bind via `Prisma.sql` parameters. |
| Separate Webhook Ingress + Payment Worker services | Same functions in-process (ingress route + worker tick) | Modular-monolith phase; both are pure functions of the registry, liftable out unchanged. |
| `aud_` audit tables | Reuse the existing `activity_logs` + audit UI | Same purpose, already admin-gated; avoids duplication (03 §7 liability rule). |

## Consequences

- **Positive**: the campus gets shop + membership + ledger today, with module
  boundaries that let separate teams build in parallel (each module folder +
  its tables + the boundary test) and split a module out later behind the
  same interface.
- **Positive**: the money path is testable offline (mock provider with
  deterministic success/decline/timeout tokens) and its invariants are
  database-enforced, not convention-enforced.
- **Negative**: two more Prisma schemas to keep in sync (both edited
  together; ADR-0002's CI diff check remains a tracked follow-up).
- **Negative**: single-tenant today — `tenantId` is carried on every money
  table but defaulted; multi-campus needs the tenant to become a real
  entity + row-level scoping in the shared repository layer.
- **Deferred** (tracked in docs/erp/BLUEPRINT.md): student SSO/roles,
  PayMongo adapter, Redis debounce, notifications (`ntf_`) + reporting
  (`rpt_`) modules, refund saga, `pay_mandates` consent table.

## Security checklist (per 06 §12)

- [x] New endpoints check authentication (`requireAdmin`) + rate limits
- [x] Public ingress authorizes by HMAC signature (timing-safe compare),
      rate-limited before verification, 5-min replay window; CSRF exemption
      is an exact-path match in `src/proxy.ts`
- [x] Provider secrets (`pay_provider_config`) read ONLY by ingress/worker
      paths; the ERP core and admin API never return them
- [x] Card data never enters the system (token references only)
- [x] Money-path failures end in defined states (docs/erp/PAYMENTS.md matrix)
- [x] All privileged ERP actions audit-logged via `logActivity`
- [x] Boundary + money-path tests (`tests/erp-boundaries.test.ts`,
      `tests/erp-money-path.test.ts`)
