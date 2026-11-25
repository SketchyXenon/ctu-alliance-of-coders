# ERP Module — Module Map & Boundaries

Source of truth: `upload/Campus Shop & Membership Platform - System Design.pdf`
("Campus Shop & Membership Platform — System Design", @Grey, Oct 2026), adapted
to this codebase per **ADR-0007**. This file is the binding contract for where
code lives, which tables a module may touch, and how modules communicate.

## The eleven modules

| Module | Table prefix | Prisma models | Owns | Publishes | Consumes |
|---|---|---|---|---|---|
| Identity & Access | `iam_` | `ErpOrg` | Org anchors (members referenced by id only until SSO lands) | `UserRegistered`, `RoleChanged` | none |
| Catalog | `cat_` | `ErpProduct`, `ErpVariant` | Products, variants, prices | `ProductPublished`, `PriceChanged` | none |
| Inventory | `inv_` | `ErpStock`, `ErpReservation` | Stock levels, reservations | `StockReserved`, `StockReleased`, `StockLow` | `OrderPlaced`, `OrderExpired`, `PaymentSucceeded` |
| Orders | `ord_` | `ErpOrder` | Order lifecycle, 15-min reservation deadline | `OrderPlaced`, `OrderPaid`, `OrderExpired` | `PaymentSucceeded`, `PaymentFailed` |
| Membership | `mem_` | `ErpPlan`, `ErpMembership` | Plans, memberships, entitlements | `MembershipActivated`, `MembershipLapsed` | `InvoicePaid`, `InvoiceFailed` |
| Billing | `bil_` | `ErpInvoice` | Invoices, billing schedule, dunning | `InvoiceDue`, `InvoicePaid`, `InvoiceFailed` | `PaymentSucceeded`, `PaymentFailed` |
| Payments | `pay_` | `ErpPaymentMethod`, `ErpPayAttempt`, `ErpWebhookEvent`, `ErpProviderConfig` | Methods (tokens only), attempts, webhook log, provider keys | `PaymentSucceeded`, `PaymentFailed`, `RefundCompleted` | `InvoiceDue`, `OrderPlaced` |
| Ledger (GL) | `gl_` | `ErpGlAccount`, `ErpJournalEntry`, `ErpJournalLine` | Chart of accounts, double-entry journal | `JournalPosted` | `PaymentSucceeded` |
| Notifications | `ntf_` | *(phase 3 — see BLUEPRINT.md)* | Templates, delivery log | none | Most events |
| Reporting | `rpt_` | *(phase 4 — read models)* | Dashboards, exports | none | All events |
| Audit | `aud_` | **reuses `ActivityLog`** | Append-only audit trail | none | All events |
| Shared kernel | `sys_` / `api_` | `ErpOutbox`, `ErpInbox`, `ErpIdempotencyKey` | Outbox, inbox, idempotency keys | — | — |

> The Audit module deliberately reuses the existing `activity_logs` table
> (same purpose, already admin-gated + UI'd). A dedicated `aud_` table would
> duplicate it — see ADR-0007 trade-offs.

## Boundary rules (enforced by `tests/erp-boundaries.test.ts`)

1. **A module reads or writes only its own tables.** No cross-module joins,
   no foreign keys across prefixes. Other modules are referenced by id only
   (plain text column, `@@index`, no `@relation`). Within a module, FKs are
   fine (`cat_variants.product`, `gl_journal_lines.journal`).
2. **Cross-module calls go through the target's public interface.** The only
   file allowed to import across module folders is `src/modules/erp/container.ts`
   (the composition root). Services receive collaborators as constructor
   dependencies shaped by each module's exported interface. Route handlers and
   app code import ONLY `@/modules/erp` (the registry) — never a module's
   internals. Imports of another module's internals fail the boundary test.
3. **State changes are announced as events.** Anything another module cares
   about is written to `sys_outbox` in the SAME transaction as the change
   (`recordOutboxEvent(tx, ...)` from `shared/outbox.ts`). Delivery is
   at-least-once; consumers dedupe via `sys_inbox` (`claimInboxEvent`).
4. **Contracts are additive within a major version.** Event payloads gain
   fields additively; a breaking change publishes a new `schema_ver` beside
   the old one until every consumer has moved.
5. **Every money table carries `tenantId`** (defaulted `"campus"` today) so a
   future multi-campus or extraction keeps its scoping key without a rewrite.

## Folder layout

```
src/modules/erp/
  index.ts          - public registry: types + wired container (import THIS)
  container.ts      - composition root (the only cross-module importer)
  worker.ts         - scheduler/relay/worker jobs (runWorkerTick)
  bootstrap.ts      - idempotent demo seed (CLI + admin UI route)
  shared/           - kernel: ulid, money, errors, events, outbox, inbox,
                      idempotency (no module may skip these helpers)
  catalog/ inventory/ orders/ membership/ billing/ payments/ ledger/
    *.service.ts    - module implementation (private)
shared kernel tests: tests/erp-boundaries.test.ts
API routes:          src/app/api/erp/** (thin adapters over the registry)
Admin console:       src/components/admin/erp-panel.tsx (ERP tab)
```

## How to add a new module (the gate from the blueprint's Phase 1)

1. Add the prefixed tables to BOTH Prisma schemas
   (`prisma/schema.sqlite.prisma` AND `prisma/schema.prisma` — keep them in
   sync per ADR-0002; Postgres uses `@map` snake_case + `@db.Uuid` ids).
2. Create `src/modules/erp/<module>/<module>.service.ts` implementing the
   module's interface. It may import: its own folder, `../shared/*`,
   `@/lib/db`. Nothing else.
3. Register the service in `container.ts` (constructor deps = other modules'
   public interfaces, wired as closures).
4. Export ONLY the interface + view types from `src/modules/erp/index.ts`.
5. Add the module to `ERP_EVENTS` in `shared/events.ts` if it publishes.
6. Extend `tests/erp-boundaries.test.ts` module list — the scan must include
   the new folder from day one.
7. Add thin API routes under `src/app/api/erp/<module>/**` that call the
   registry; add rate limits + `requireAdmin`/`requireSuperAdmin` per the
   existing security architecture (docs/SECURITY.md).
