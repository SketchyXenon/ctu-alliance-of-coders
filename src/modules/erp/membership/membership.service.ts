// ERP Membership module (mem_) — plans, memberships, benefits, entitlements.
// Publishes: MembershipActivated, MembershipLapsed.
// Consumes: InvoicePaid, InvoiceFailed (via billing settlement callbacks).
//
// The first payment is the consent moment: a member subscribes with a saved
// payment method; the method row carries the recorded consent (consentVersion
// + consentedAt) — no saved method exists without a recorded consent.

import { ulid } from "../shared/ulid";
import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface MembershipView {
  id: string;
  publicId: string;
  planId: string;
  memberRef: string;
  status: string;
  currentPeriodEnd: string | null;
}

export interface MembershipApi {
  createPlan(args: { tenantId: string; orgId: string; name: string; amountMinor: number; period?: string }): Promise<MembershipView & { planPublicId: string }>;
  /** Subscribe a member to a plan: creates the membership (PENDING) + the
   *  first invoice for the current period via the billing module. The first
   *  payment settles through the standard payment flow. */
  subscribe(args: { tenantId: string; planId: string; memberRef: string; correlationId?: string | null }): Promise<{ membership: MembershipView; invoiceId: string; invoiceAmountMinor: number; dueAt: string }>;
  /** Transaction-safe activation, called by billing when an invoice is paid. */
  activateMembership(tx: Tx, args: { tenantId: string; membershipId: string; periodStart: Date; periodEnd: Date; correlationId?: string | null }): Promise<void>;
  /** Transaction-safe lapse, called by billing/dunning when retries exhaust. */
  lapseMembership(tx: Tx, args: { tenantId: string; membershipId: string; correlationId?: string | null }): Promise<void>;
  listMemberships(limit?: number): Promise<MembershipView[]>;
}

export class MembershipService {
  constructor(
    private billing: {
      ensureInvoiceForPeriod: (args: {
        tenantId: string;
        membershipId: string;
        memberRef: string;
        amountMinor: number;
        currency: string;
        periodStart: Date;
        periodEnd: Date;
        dueAt: Date;
        correlationId?: string | null;
      }) => Promise<{ invoiceId: string; amountMinor: number; dueAt: Date; created: boolean }>;
    }
  ) {}

  async createPlan(args: { tenantId: string; orgId: string; name: string; amountMinor: number; period?: string }) {
    assertAmountMinor(args.amountMinor, "plan amount");
    if (!args.name || args.name.length > 200) {
      throw new ErpError("VALIDATION", "Plan name is required (max 200 chars).");
    }
    const plan = await db.erpPlan.create({
      data: {
        publicId: ulid(),
        tenantId: args.tenantId,
        orgId: args.orgId,
        name: args.name,
        amountMinor: args.amountMinor,
        period: args.period === "YEARLY" ? "YEARLY" : "MONTHLY",
      },
    });
    return {
      id: plan.id,
      publicId: plan.publicId,
      planPublicId: plan.publicId,
      planId: plan.id,
      memberRef: "",
      status: "PLAN",
      currentPeriodEnd: null,
    };
  }

  async subscribe(args: { tenantId: string; planId: string; memberRef: string; correlationId?: string | null }) {
    const plan = await db.erpPlan.findUnique({ where: { id: args.planId } });
    if (!plan || !plan.active) {
      throw new ErpError("NOT_FOUND", "Plan not found or inactive.");
    }

    // Month-aligned period bounds (periodStart = first day of current month).
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h first-payment window

    const membership = await db.erpMembership.create({
      data: {
        publicId: ulid(),
        planId: plan.id,
        memberRef: args.memberRef,
        status: "PENDING",
      },
    });

    // One invoice per membership per period (unique key) — a scheduler firing
    // twice cannot bill one period twice.
    const invoice = await this.billing.ensureInvoiceForPeriod({
      tenantId: args.tenantId,
      membershipId: membership.id,
      memberRef: args.memberRef,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      periodStart,
      periodEnd,
      dueAt,
      correlationId: args.correlationId ?? null,
    });

    return {
      membership: {
        id: membership.id,
        publicId: membership.publicId,
        planId: membership.planId,
        memberRef: membership.memberRef,
        status: membership.status,
        currentPeriodEnd: null,
      },
      invoiceId: invoice.invoiceId,
      invoiceAmountMinor: invoice.amountMinor,
      dueAt: invoice.dueAt.toISOString(),
    };
  }

  async activateMembership(
    tx: Tx,
    args: { tenantId: string; membershipId: string; periodStart: Date; periodEnd: Date; correlationId?: string | null }
  ): Promise<void> {
    const membership = await tx.erpMembership.findUnique({ where: { id: args.membershipId } });
    if (!membership) throw new ErpError("NOT_FOUND", "Membership not found.");
    const updated = await tx.erpMembership.updateMany({
      where: { id: args.membershipId, status: { in: ["PENDING", "ACTIVE", "LAPSED"] } },
      data: {
        status: "ACTIVE",
        currentPeriodStart: args.periodStart,
        currentPeriodEnd: args.periodEnd,
      },
    });
    if (updated.count === 0) return; // cancelled — never auto-reactivate
    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.membershipActivated,
      tenantId: args.tenantId,
      aggregateId: args.membershipId,
      correlationId: args.correlationId ?? null,
      payload: {
        membershipPublicId: membership.publicId,
        memberRef: membership.memberRef,
        periodEnd: args.periodEnd.toISOString(),
      },
    });
  }

  async lapseMembership(
    tx: Tx,
    args: { tenantId: string; membershipId: string; correlationId?: string | null }
  ): Promise<void> {
    const membership = await tx.erpMembership.findUnique({ where: { id: args.membershipId } });
    if (!membership) return;
    const updated = await tx.erpMembership.updateMany({
      where: { id: args.membershipId, status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "LAPSED" },
    });
    if (updated.count === 0) return;
    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.membershipLapsed,
      tenantId: args.tenantId,
      aggregateId: args.membershipId,
      correlationId: args.correlationId ?? null,
      payload: { membershipPublicId: membership.publicId, memberRef: membership.memberRef },
    });
  }

  async listMemberships(limit = 20): Promise<MembershipView[]> {
    const rows = await db.erpMembership.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((m) => ({
      id: m.id,
      publicId: m.publicId,
      planId: m.planId,
      memberRef: m.memberRef,
      status: m.status,
      currentPeriodEnd: m.currentPeriodEnd ? m.currentPeriodEnd.toISOString() : null,
    }));
  }
}
