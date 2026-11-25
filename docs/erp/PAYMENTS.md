# ERP Payments — The Money Path

Adapted from the blueprint PDF ("Checkout and auto-debit flow",
"Debounce, idempotency and ACID", "Failure handling"). This is the reference
for anyone touching `src/modules/erp/payments/`, `orders/`, or `billing/`.

## A charge is recorded before it is sent, and settled only by a signed webhook

```
Student/Admin      ERP Core              Provider (mock)        Webhook Ingress
    |                  |                        |                      |
    |--1 POST /api/erp/checkout----------------->|                      |
    |                  | 2 Txn A: reserve       |                      |
    |<--3 202/201------|   (order+stock+attempt)|                      |
    |                  |--4 submit (INITIATED→SUBMITTED)               |
    |                  |--5 charge + stored key (OUTSIDE any txn)      |
    |                  |                        |--6 signed webhook--->|
    |                  |                        |   verify+store only  |
    |                  |<--7 worker tick: Txn B (settle) ---------------|
    |<--8 receipt/receipt via UI-----------------|                      |
```

- **Transaction A** (`orders.placeOrder`) — ONE transaction: create the order
  `PENDING_PAYMENT` with a 15-minute expiry; reserve stock with conditional
  updates in `variant_id` order (zero rows = sold out, whole txn rolls back);
  insert the `pay_attempts` row as `INITIATED` with its provider key
  (`pay_{attemptPublicId}`); write `OrderPlaced` to the outbox. Commit.
- **Provider call** (`payments.submitAttempt`) — flip the attempt
  `INITIATED → SUBMITTED` with a conditional update, then call the provider
  using the STORED key. No DB lock is held across the network call. The mock
  provider approves instantly; redirect methods (GCash/Maya in production)
  would return a next-action URL here.
- **Transaction B** (`payments.settleReceivedEvent`) — on `payment.paid`:
  claim the worker inbox; if the attempt is already `SUCCEEDED`, commit and
  stop (duplicate event); check amount + currency against the attempt (a
  mismatch flags the attempt `MISMATCH` and fulfills nothing); set the
  attempt `SUCCEEDED` and clear `active_slot`; settle the payable (order →
  `PAID` only `WHERE status = 'PENDING_PAYMENT'` + commit reservations +
  decrement stock; invoice → `PAID` + activate membership); post the balanced
  journal; write `PaymentSucceeded` + `OrderPaid`/`InvoicePaid` to the
  outbox. Commit.

If Transaction B fails, nothing is half-applied: the attempt stays
`SUBMITTED`, the webhook stays `RECEIVED`, and the next worker tick replays
the same transaction.

## The six debounce / idempotency layers

A customer is charged once because six layers each assume the one before it
failed; only layers 3–6 are correctness guards (1–2 reduce noise/cost).

| # | Layer | Mechanism in this codebase | Guard? |
|---|---|---|---|
| 1 | Browser | Admin console disables the action button while submitting; each click sends a fresh `Idempotency-Key` UUID (`erp-panel.tsx`) | No |
| 2 | API debounce | Route rate limits (`erp-checkout: 10/min/IP`, `erp-worker: 30/min/admin`) — Redis debounce is deferred (ADR-0007) | No |
| 3 | API idempotency | Required `Idempotency-Key` header; claim row in `api_idempotency_keys`; same key + same body replays the stored response; same key + different body → 422; claim taken over if a flow crashes (2-min staleness) (`shared/idempotency.ts`) | **Yes** |
| 4 | Database invariants | `uq_one_in_flight` (unique `(payable_type, payable_id, active_slot)` — many NULLs allowed, second in-flight attempt rejected by the DB), `uq_one_invoice_per_period`, `uq_provider_idem`, `uq_event` on `pay_webhook_events` | **Yes** |
| 5 | Provider call | Deterministic key `pay_{attemptPublicId}` stored BEFORE the call and reused on every retry — the mock provider (like PayMongo) returns the original result on a repeat | **Yes** |
| 6 | Webhook intake | Verify the HMAC signature against the RAW body, insert-or-ignore on `(provider, event_id)`, settle through the state machine; duplicates are acknowledged 200 with no change | **Yes** |

## Merchant-triggered renewals (push mode)

`runWorkerTick` (`src/modules/erp/worker.ts`) claims due invoices with a
lease — `claimDueInvoice` performs a conditional update
(`WHERE status = 'DUE' AND (claimed_by IS NULL OR lease_until < now())`) and
proceeds only when one row was affected, so two workers never take the same
invoice. The charge reuses the member's saved method (`pay_methods` carries
the recorded consent — no saved method exists without a recorded consent).
Failures enter dunning: retry tomorrow, lapse the membership after 3 failed
invoices (blueprint: up to 3 tries, 24 h apart).

## Failure handling matrix

| Failure | What the system does | End state |
|---|---|---|
| Provider call times out | Attempt `SUBMITTED` → `UNKNOWN` after 30 s; the sweeper (`sweepStuckAttempts`) re-queries by reference / replays with the same idempotency key | Attempt resolves `SUCCEEDED` or `FAILED` |
| Duplicate webhook | Insert-or-ignore on `(provider, event_id)`; `SUCCEEDED → SUCCEEDED` is a no-op; handler still returns 200 | No change |
| Webhook before our commit | The event carries the attempt `public_id` in its metadata; if the row is not visible yet the event stays `RECEIVED` and is retried with backoff | Settled once the attempt exists |
| Webhook endpoint down | Provider retries delivery (mock re-delivers every tick); the sweeper also resolves attempts `SUBMITTED`/`UNKNOWN` > 5 min | Settled by whichever arrives first |
| Card declined (`tok_fail`) | Attempt `FAILED`, slot cleared; shop order stays open until expiry (try another method); invoice enters dunning | Retry or lapse by policy |
| Payment lands after expiry | Txn B surfaces `STATE_CONFLICT`; the event stays `RECEIVED` flagged for the re-reserve-or-refund saga (**roadmap**, see BLUEPRINT.md phase 5) | Manual review (skeleton) |
| Amount/currency differs | Attempt flagged `MISMATCH`, nothing fulfilled | Manual review |
| Worker crashes mid-charge | Lease on the claimed invoice expires; another worker reclaims and reuses the same provider key | One charge |
| Unbalanced journal | `ledger.postJournal` throws `UNBALANCED_JOURNAL` before commit | Nothing committed |

## Test tokens (mock provider only)

| tokenRef | Behavior | Use |
|---|---|---|
| `tok_success` (default, seeded) | Charge succeeds | Happy path |
| `tok_fail` | Charge fails `insufficient_funds` | Decline + dunning path |
| `tok_timeout` | Charge returns `UNKNOWN` | Sweeper / timeout path |

To test a decline: update the admin's `pay_methods.tokenRef` to `tok_fail`
(SQL or a debug script), run a checkout, then run the worker tick — the
attempt settles `FAILED` and (for invoices) dunning requeues the invoice.

## Reconciliation

Two jobs close the loop (blueprint): the 5-minute stuck-attempt sweeper over
`ix_(status, updated_at)`, and the ledger balance check
(`erp.ledger.getTrialBalance()` — surfaced live in the admin ERP console; the
blueprint's nightly job compares the provider's settlement report with
`pay_attempts` + the journal).

## Observability targets (adapted from the blueprint)

- Trace every request with a `correlationId` that follows the outbox event.
- No attempt left in `SUBMITTED` or `UNKNOWN` for more than 10 minutes.
- Outbox lag under 30 s (the ERP console's "Outbox lag" KPI card).
- Daily reconciliation shows zero unexplained differences (ledger balanced).
