// ERP worker orchestrator — the blueprint's "Scheduler + Outbox Relay" and
// "Payment Worker" as in-process jobs.
//
// Blueprint: "the scheduler and outbox relay are extra processes started from
// the core's codebase." In this modular-monolith phase they run inside the
// Next.js server behind POST /api/erp/worker/tick (admin-triggered; in
// production the same functions become the Payment Worker service's loop —
// see docs/erp/BLUEPRINT.md, phase 2 extraction path). Every job is bounded
// and idempotent; running the tick twice never double-charges.

import { erp } from "./container";
import { relayOutboxBatch } from "./shared/outbox";
import { purgeExpiredIdempotencyKeys } from "./shared/idempotency";

export interface WorkerTickResult {
  relay: { relayed: number; topics: string[] };
  delivered: number;
  processed: number;
  failed: number;
  requeued: number;
  swept: number;
  invoicesDue: number;
  invoicesCharged: number;
  ordersExpired: number;
  idempotencyPurged: number;
}

/** Run one bounded pass of every background job. Safe to run concurrently:
 *  claims are conditional updates, deliveries dedupe on (provider, event_id),
 *  settlements dedupe on the worker inbox, invoice creation dedupes on the
 *  per-period unique key. */
export async function runWorkerTick(): Promise<WorkerTickResult> {
  // 1. Outbox relay: publish NEW events to the in-process sink, mark SENT.
  const relay = await relayOutboxBatch(50);

  // 2. Billing scheduler: flip SCHEDULED invoices to DUE.
  const due = await erp.billing.markDueInvoices();

  // 3. Push-mode renewals: claim due invoices with a lease and charge them
  //    against the member's saved method (consent recorded on the method).
  let invoicesCharged = 0;
  const dueInvoices = await erp.billing.listRecentInvoices(50);
  for (const invoice of dueInvoices) {
    if (invoice.status !== "DUE") continue;
    const claimed = await erp.billing.claimDueInvoice(invoice.id, "worker-tick");
    if (!claimed) continue; // another worker holds a live lease
    const method = await findMethodForMember(invoice.membershipId);
    if (!method) continue; // no saved method: stays DUE for the retry policy
    try {
      await erp.payments.startInvoiceAttempt({
        invoiceId: invoice.id,
        tenantId: "campus",
        methodId: method.id,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
      });
      invoicesCharged += 1;
    } catch {
      // Claim lapses (lease_until passes) and the next tick retries — the
      // blueprint's retry-then-grace policy handled by settleInvoiceFailed.
    }
  }

  // 4. Payment worker: deliver provider events, settle RECEIVED events (Txn B),
  //    sweep attempts stuck in SUBMITTED/UNKNOWN.
  const delivered = await erp.payments.deliverPendingProviderEvents();
  const report = await erp.payments.processReceivedEvents();
  const swept = await erp.payments.sweepStuckAttempts();

  // 5. Orders sweeper: expire past-deadline orders (releases stock).
  const expired = await erp.orders.expireStaleOrders();

  // 6. Maintenance: purge expired idempotency claims.
  const idempotencyPurged = await purgeExpiredIdempotencyKeys();

  return {
    relay,
    delivered: delivered.delivered,
    processed: report.processed,
    failed: report.failed,
    requeued: report.requeued,
    swept: swept.swept,
    invoicesDue: due.due,
    invoicesCharged,
    ordersExpired: expired.expired,
    idempotencyPurged,
  };
}

async function findMethodForMember(membershipId: string): Promise<{ id: string } | null> {
  // memberRef is the saved-method owner; the newest ACTIVE method is used.
  // (Membership -> method lookup by reference only — no cross-module join:
  // we query each module's own table and stitch in application code.)
  const { db } = await import("@/lib/db");
  const membership = await db.erpMembership.findUnique({
    where: { id: membershipId },
    select: { memberRef: true },
  });
  if (!membership) return null;
  const method = await db.erpPaymentMethod.findFirst({
    where: { ownerRef: membership.memberRef, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return method;
}
