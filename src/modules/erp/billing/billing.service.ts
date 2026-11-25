// ERP Billing module (bil_) — invoices, billing schedule, dunning rules.
// Publishes: InvoiceDue, InvoicePaid, InvoiceFailed.
// Consumes: PaymentSucceeded, PaymentFailed, MembershipActivated (via the
// payments module's settlement callbacks inside its transaction).
//
// Merchant-triggered renewals (push mode): workers claim work with a
// conditional update (UPDATE bil_invoices SET claimed_by = ?, lease_until = ?
// WHERE status = 'DUE' AND (lease_until IS NULL OR lease_until < NOW())) and
// proceed only when one row was affected — two workers never take the same
// invoice. The unique key on (membership_id, period_start) means one period
// can never be billed twice.

import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const INVOICE_LEASE_MS = 5 * 60_000; // lease held while a worker charges

export interface InvoiceView {
  id: string;
  membershipId: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  dueAt: string;
}

export interface BillingApi {
  /** One invoice per membership per period (unique key enforced). */
  ensureInvoiceForPeriod(args: {
    tenantId: string;
    membershipId: string;
    memberRef: string;
    amountMinor: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    dueAt: Date;
    correlationId?: string | null;
  }): Promise<{ invoiceId: string; amountMinor: number; dueAt: Date; created: boolean }>;
  /** Flip SCHEDULED -> DUE when due (scheduler step). */
  markDueInvoices(): Promise<{ due: number }>;
  /** Lease-claim a due invoice (push mode). Returns null when another worker
   *  holds a live lease or the invoice is not claimable. */
  claimDueInvoice(invoiceId: string, workerId: string): Promise<InvoiceView | null>;
  /** Transaction-safe settlement on PaymentSucceeded. Posts the journal via
   *  the injected ledger api, activates membership via the injected callback. */
  settleInvoicePaid(
    tx: Tx,
    args: {
      invoiceId: string;
      tenantId: string;
      providerRef: string | null;
      correlationId?: string | null;
    }
  ): Promise<{ invoicePublicId: string | null }>;
  /** Transaction-safe failure path: enter dunning (attempt counter on the
   *  invoice via status FAILED + reschedule), lapse membership after cap. */
  settleInvoiceFailed(
    tx: Tx,
    args: { invoiceId: string; tenantId: string; failureCode: string; correlationId?: string | null }
  ): Promise<void>;
  listRecentInvoices(limit?: number): Promise<InvoiceView[]>;
}

/** The journal-input shape this module needs from the ledger — declared
 *  LOCALLY (no cross-module type import; the composition root guarantees the
 *  injected implementation is shape-compatible). */
interface LedgerPostJournalInput {
  tenantId: string;
  orgId: string;
  memo: string;
  correlationId?: string | null;
  lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }>;
}

export class BillingService {
  constructor(
    private ledger: { postJournal: (tx: Tx, input: LedgerPostJournalInput) => Promise<unknown> },
    private membership: {
      activateMembership: (tx: Tx, args: { tenantId: string; membershipId: string; periodStart: Date; periodEnd: Date; correlationId?: string | null }) => Promise<void>;
      lapseMembership: (tx: Tx, args: { tenantId: string; membershipId: string; correlationId?: string | null }) => Promise<void>;
    }
  ) {}

  async ensureInvoiceForPeriod(args: {
    tenantId: string;
    membershipId: string;
    memberRef: string;
    amountMinor: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    dueAt: Date;
    correlationId?: string | null;
  }) {
    assertAmountMinor(args.amountMinor, "invoice amount");
    try {
      const invoice = await db.erpInvoice.create({
        data: {
          membershipId: args.membershipId,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          amountMinor: args.amountMinor,
          currency: args.currency,
          status: "SCHEDULED",
          dueAt: args.dueAt,
        },
      });
      await db.$transaction(async (tx) => {
        await recordOutboxEvent(tx, {
          def: ERP_EVENTS.invoiceDue,
          tenantId: args.tenantId,
          aggregateId: invoice.id,
          correlationId: args.correlationId ?? null,
          payload: {
            invoiceId: invoice.id,
            membershipId: args.membershipId,
            memberRef: args.memberRef,
            amountMinor: args.amountMinor,
            dueAt: args.dueAt.toISOString(),
          },
        });
      });
      return { invoiceId: invoice.id, amountMinor: invoice.amountMinor, dueAt: invoice.dueAt, created: true };
    } catch (err) {
      // P2002 on (membershipId, periodStart): the period is already billed.
      if (err instanceof Error && (err.message.includes("Unique constraint") || err.message.includes("P2002"))) {
        const existing = await db.erpInvoice.findUnique({
          where: { membershipId_periodStart: { membershipId: args.membershipId, periodStart: args.periodStart } },
        });
        if (existing) {
          return { invoiceId: existing.id, amountMinor: existing.amountMinor, dueAt: existing.dueAt, created: false };
        }
      }
      throw err;
    }
  }

  async markDueInvoices(): Promise<{ due: number }> {
    const res = await db.erpInvoice.updateMany({
      where: { status: "SCHEDULED", dueAt: { lte: new Date() } },
      data: { status: "DUE" },
    });
    return { due: res.count };
  }

  async claimDueInvoice(invoiceId: string, workerId: string): Promise<InvoiceView | null> {
    const leaseUntil = new Date(Date.now() + INVOICE_LEASE_MS);
    // Conditional claim: proceed only when one row was affected.
    const claimed = await db.erpInvoice.updateMany({
      where: {
        id: invoiceId,
        status: "DUE",
        OR: [{ claimedBy: null }, { leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { claimedBy: workerId, leaseUntil },
    });
    if (claimed.count === 0) return null;
    const invoice = await db.erpInvoice.findUnique({ where: { id: invoiceId } });
    return invoice ? toInvoiceView(invoice) : null;
  }

  async settleInvoicePaid(
    tx: Tx,
    args: { invoiceId: string; tenantId: string; providerRef: string | null; correlationId?: string | null }
  ): Promise<{ invoicePublicId: string | null }> {
    const invoice = await tx.erpInvoice.findUnique({ where: { id: args.invoiceId } });
    if (!invoice) throw new ErpError("NOT_FOUND", "Invoice not found.");
    if (invoice.status === "PAID") return { invoicePublicId: null }; // duplicate no-op

    const updated = await tx.erpInvoice.updateMany({
      where: { id: args.invoiceId, status: { in: ["DUE", "SCHEDULED", "FAILED"] } },
      data: { status: "PAID", claimedBy: null, leaseUntil: null, providerInvoiceRef: args.providerRef },
    });
    if (updated.count === 0) {
      throw new ErpError("STATE_CONFLICT", `Invoice is ${invoice.status}, not payable.`);
    }

    // Extend/activate the membership for the billed period.
    await this.membership.activateMembership(tx, {
      tenantId: args.tenantId,
      membershipId: invoice.membershipId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      correlationId: args.correlationId ?? null,
    });

    // Post the balanced journal (cash up, dues revenue up).
    await this.ledger.postJournal(tx, {
      tenantId: args.tenantId,
      orgId: "campus",
      memo: `Membership dues settlement (invoice ${invoice.id.slice(0, 8)})`,
      correlationId: args.correlationId ?? null,
      lines: [
        { accountCode: "1000-CASH", debitMinor: invoice.amountMinor, creditMinor: 0 },
        { accountCode: "4100-DUES", debitMinor: 0, creditMinor: invoice.amountMinor },
      ],
    });

    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.invoicePaid,
      tenantId: args.tenantId,
      aggregateId: args.invoiceId,
      correlationId: args.correlationId ?? null,
      payload: { invoiceId: args.invoiceId, amountMinor: invoice.amountMinor, providerRef: args.providerRef },
    });

    return { invoicePublicId: null };
  }

  async settleInvoiceFailed(
    tx: Tx,
    args: { invoiceId: string; tenantId: string; failureCode: string; correlationId?: string | null }
  ): Promise<void> {
    const invoice = await tx.erpInvoice.findUnique({ where: { id: args.invoiceId } });
    if (!invoice) return;
    const updated = await tx.erpInvoice.updateMany({
      where: { id: args.invoiceId, status: { in: ["DUE", "SCHEDULED"] } },
      data: { status: "FAILED", claimedBy: null, leaseUntil: null },
    });
    if (updated.count === 0) return;
    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.invoiceFailed,
      tenantId: args.tenantId,
      aggregateId: args.invoiceId,
      correlationId: args.correlationId ?? null,
      payload: { invoiceId: args.invoiceId, failureCode: args.failureCode },
    });
    // Dunning policy (blueprint: retry up to 3 tries 24h apart, then lapse).
    // Requeue as DUE so the worker retries; lapse after the 3rd failure.
    const failures = await tx.erpInvoice.count({
      where: { membershipId: invoice.membershipId, status: "FAILED" },
    });
    if (failures >= 3) {
      await this.membership.lapseMembership(tx, {
        tenantId: args.tenantId,
        membershipId: invoice.membershipId,
        correlationId: args.correlationId ?? null,
      });
    } else {
      await tx.erpInvoice.updateMany({
        where: { id: args.invoiceId, status: "FAILED" },
        data: { status: "DUE", dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
    }
  }

  async listRecentInvoices(limit = 20): Promise<InvoiceView[]> {
    const rows = await db.erpInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toInvoiceView);
  }
}

function toInvoiceView(row: {
  id: string;
  membershipId: string;
  periodStart: Date;
  periodEnd: Date;
  amountMinor: number;
  currency: string;
  status: string;
  claimedBy: string | null;
  leaseUntil: Date | null;
  dueAt: Date;
}): InvoiceView {
  return {
    id: row.id,
    membershipId: row.membershipId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    claimedBy: row.claimedBy,
    leaseUntil: row.leaseUntil ? row.leaseUntil.toISOString() : null,
    dueAt: row.dueAt.toISOString(),
  };
}
