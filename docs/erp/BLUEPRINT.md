# ERP Blueprint — Implementation Plan for the Development Team

This document turns the system-design PDF into a concrete, phased build plan
inside THIS codebase. Read in order: `docs/adr/0007-erp-modular-monolith.md`
(why), `docs/erp/MODULES.md` (boundaries), `docs/erp/PAYMENTS.md` (money path),
this file (what to build, in what order, and each phase's exit gate).

## What already exists (phase 0 — shipped as the skeleton)

- All seven core modules' services + shared kernel (`src/modules/erp/`),
  prefixed tables in BOTH Prisma schemas, boundary test, registry API routes:
  - `POST /api/erp/checkout` (shop + membership, idempotent)
  - `POST /api/erp/webhooks/payment` (public HMAC ingress)
  - `POST /api/erp/worker/tick` (all background jobs, idempotent)
  - `GET /api/erp/status`, `GET /api/erp/orders`, `POST /api/erp/bootstrap`
- Admin dev console (ERP tab): seed, checkout, subscribe, worker tick, live
  tables for orders / attempts / invoices / webhook events / ledger balance.
- Test tokens + failure paths (decline, timeout/sweeper, duplicate webhook,
  double-billing guard) — `docs/erp/PAYMENTS.md`.

## Phase 1 — Identity & real checkout UX (student-facing)

**Goal**: students, not admins, drive the flows.
- Campus SSO (OIDC against Google Workspace / Microsoft Entra) issuing
  short-lived JWTs; refresh rotation; MFA mandatory for finance/admin roles
  (blueprint "Identity"). Map SSO subject → `iam_` member rows; keep
  `buyerRef`/`memberRef` unchanged (they are opaque id references).
- Student shop UI: catalog grid, cart, checkout page (new section under `/`
  per the app's single-route architecture), order status + receipts page.
- Role model: extend the existing two-tier admin roles with scoped roles
  (student, org officer, cashier, org finance, campus finance admin) —
  authorization lives in the shared repository layer, not per module
  (blueprint "Authorization").
- **Gate**: a student can buy one item end-to-end; one request traces end to
  end (correlationId → outbox → worker).

## Phase 2 — Real payment provider (PayMongo) behind the existing port

**Goal**: replace the mock adapter without touching any caller.
- Implement `PaymentProvider` (`src/modules/erp/payments/provider.ts`) for
  PayMongo: one-time cards + e-wallets, hosted fields (card data never
  touches this system — blueprint "Card data scope"), tokens stored instead
  of raw numbers, `payment.paid`/`payment.failed` webhooks signed and
  verified exactly like the ingress already does.
- Provider keys live ONLY in the worker/ingress paths (`pay_provider_config`
  row per provider — test and live keys kept apart, documented rotation).
- Run the worker as a real background process: `runWorkerTick()` on an
  interval (node-cron in a long-running process, or a queue consumer per the
  blueprint's BullMQ row). The function is already extraction-ready.
- **Gate**: chaos test — workers killed mid-charge, every webhook replayed
  12×, provider timeouts injected → zero duplicate charges, every journal
  balances.

## Phase 3 — Membership & auto-debit hardening

**Goal**: recurring billing with compliance guardrails.
- Confirm the provider's saved-method / off-session capability IN WRITING
  before building (blueprint "Risks" — the #1 risk). Fallbacks: Maya
  on-demand billing, a prepaid campus wallet, or renewal reminders with a
  one-tap pay link.
- Consent flows: `pay_mandates` table (what the method may be used for, terms
  version, when), notice before each renewal charge, cancel takes effect
  before the next charge.
- Notifications module (`ntf_` templates + delivery log) consuming most
  events: receipts, renewal reminders, dunning notices.
- Pull mode for cards (provider runs the schedule; ERP matches the provider's
  invoice to the one it already created per period — the
  `uq_one_invoice_per_period` guard makes this safe).
- **Gate**: three simulated renewal cycles succeed in sandbox; compliance
  approves the consent + cancel flows.

## Phase 4 — Back office & reporting

**Goal**: finance closes a month without spreadsheets.
- Reporting module (`rpt_` read models): org dashboards, settlements/payouts
  per org, refunds with approvals (second-approver rule above a threshold),
  TiFlash-style report tables (prod analytics read from replicas).
- Audit views over `activity_logs` with filters (actor, action, target).
- **Gate**: finance closes a month from the system.

## Phase 5 — Failure sagas, hardening, launch

- Late-payment saga: on `STATE_CONFLICT` settlement (order expired), record
  the success, then re-reserve stock if available, else start an automatic
  refund with its own idempotency key + notify the student (blueprint
  failure #6). Extend `RefundCompleted` (already in the event catalog).
- QR pickup / claim codes as a new `ord_` feature; event ticketing as a NEW
  module (never a field on orders — that's what the boundaries are for).
- Penetration test, restore drill, pilot with one org, then campus-wide.
- **Gate**: pilot runs two settlement cycles with zero unresolved
  reconciliation differences.

## Coding rules (non-negotiable, per the blueprint's data-layer rules)

1. One short transaction per business step; NO network call inside a
   transaction (the provider call is always between Txn A and Txn B).
2. Lock, then check, then write: a plain read is an unlocked snapshot; when a
   decision depends on a value, use a conditional update
   (`updateMany` + count check) or `SELECT ... FOR UPDATE` raw SQL.
3. Money is an integer (centavos) through `shared/money.ts`. Never floats.
4. Fixed lock order across modules: order → stock → payment → journal.
   Retry write-conflict/deadlock errors up to 3 times with jittered backoff
   (`withDbRetry` in `@/lib/db`).
5. Public ids are ULIDs (`shared/ulid.ts`); internal PKs never leave the API.
6. Ledger lines, stock movements, audit rows are append-only; corrections are
   new reversing rows.
7. Schema changes are expand → deploy → backfill → contract; DDL off-peak.
8. Every new endpoint: `requireAdmin`/`requireSuperAdmin` + rate limit +
   audit log (docs/SECURITY.md) — the ERP module inherits the platform's
   full security architecture.

## Test strategy

| Layer | Where | What |
|---|---|---|
| Boundary (architecture) | `tests/erp-boundaries.test.ts` | Cross-module deep imports fail; routes import only the registry |
| Money path (integration) | `tests/erp-money-path.test.ts` | Golden flow: place → submit → webhook → settle → PAID + balanced journal; duplicate webhook no-op; double-submission rejected by `uq_one_in_flight`; sold-out rollback; invoice-per-period guard; lease claim |
| Kernel (unit) | `tests/erp-money-path.test.ts` | ULID shape/uniqueness, money guards, unbalanced journal rejected |
| E2E (manual) | Admin ERP tab | Seed → checkout → worker tick → observe PAID + ledger balanced |

Run: `bun run test` (all suites; the pretest pushes the SQLite test schema).

## Extraction path (when a module outgrows the core)

Each module already talks to others only through interfaces wired in
`container.ts`. To extract, e.g. Payments into its own service:

1. Move `payments/` + `shared/` + its tables behind the same interface
   (HTTP or queue), swap the container wiring for a client that implements
   `PaymentsApi`.
2. Nothing else changes — no module ever imported Payments' internals.
