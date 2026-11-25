// ERP Payments module (pay_) — attempts, provider execution, webhook intake,
// settlement (Transaction B), and the stuck-attempt sweeper.
//
// Publishes: PaymentSucceeded, PaymentFailed, RefundCompleted.
// Consumes: InvoiceDue, OrderPlaced (via callbacks wired in the container).
//
// ACID: where each transaction starts and ends (blueprint):
//   Txn A (orders.placeOrder) — order + reservations + attempt INITIATED.
//   Provider call — OUTSIDE any transaction (never hold a DB lock across the
//   network; the worker flips INITIATED -> SUBMITTED with a conditional
//   update, then calls the provider using the stored key).
//   Txn B (settleReceivedEvent) — lock the attempt, check amount/currency,
//   set SUCCEEDED + clear active_slot, settle the payable, post the balanced
//   journal, write PaymentSucceeded + OrderPaid/InvoicePaid to the outbox.
//
// If Txn B fails, nothing is half-applied: the attempt stays SUBMITTED, the
// webhook stays RECEIVED, and the next tick replays the same transaction.

import { createHmac, timingSafeEqual } from "node:crypto";
import { ulid } from "../shared/ulid";
import { recordOutboxEvent } from "../shared/outbox";
import { claimInboxEvent } from "../shared/inbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";
import type { PaymentProvider, ProviderChargeResult } from "./provider";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

const WEBHOOK_MAX_AGE_MS = 5 * 60_000; // replay window (matches the site webhook)
const STUCK_ATTEMPT_MS = 5 * 60_000; // sweeper: SUBMITTED/UNKNOWN > 5 min
const UNKNOWN_AFTER_MS = 30_000; // attempt moves to UNKNOWN after 30 s
const WORKER_CONSUMER = "payments-worker";

export interface IngestResult {
  accepted: boolean;
  duplicate: boolean;
  eventId: string;
}

export interface WorkerTickReport {
  delivered: number; // provider events ingested this tick
  processed: number; // RECEIVED events settled (Txn B)
  failed: number; // events marked FAILED
  swept: number; // stuck attempts resolved
  requeued: number; // events left RECEIVED (retry with backoff)
}

export interface PaymentsApi {
  /** Bootstrap the mock provider config (secret generated once). */
  ensureProviderConfig(providerId?: string): Promise<{ providerId: string; enabled: boolean }>;
  /** The HMAC signature a provider would send for a delivery. */
  signDelivery(rawBody: string, timestamp: string, providerId?: string): Promise<string>;
  /** WEBHOOK INGRESS: verify + store + acknowledge fast. No business logic.
   *  Signature verified against the RAW body before any parsing; duplicate
   *  deliveries are insert-or-ignored on (provider, event_id). */
  ingestSignedEvent(args: { rawBody: string; signature: string; timestamp: string; providerId?: string }): Promise<IngestResult>;
  /** Flip INITIATED -> SUBMITTED (conditional), then call the provider
   *  OUTSIDE any transaction. No DB lock is held across the network call. */
  submitAttempt(attemptPublicId: string, provider?: PaymentProvider): Promise<{ attemptPublicId: string; providerStatus: ProviderChargeResult["status"]; providerRef: string | null }>;
  /** WORKER: deliver pending provider events for SUBMITTED/UNKNOWN attempts
   *  (the mock provider re-delivers until acknowledged — mirrors real
   *  providers retrying up to 12 times). */
  deliverPendingProviderEvents(provider?: PaymentProvider): Promise<{ delivered: number }>;
  /** WORKER: settle RECEIVED events through Transaction B. */
  processReceivedEvents(provider?: PaymentProvider): Promise<WorkerTickReport>;
  /** WORKER: resolve attempts stuck in SUBMITTED/UNKNOWN (timeout path). */
  sweepStuckAttempts(provider?: PaymentProvider): Promise<{ swept: number }>;
  /** Push-mode renewal: create + submit an attempt for a claimed invoice. */
  startInvoiceAttempt(args: { invoiceId: string; tenantId: string; methodId: string; amountMinor: number; currency?: string }): Promise<{ attemptPublicId: string; providerStatus: string }>;
  listRecentAttempts(limit?: number): Promise<Array<{
    publicId: string;
    payableType: string;
    payableId: string;
    attemptNo: number;
    status: string;
    amountMinor: number;
    providerRef: string | null;
    updatedAt: string;
  }>>;
  listRecentWebhookEvents(limit?: number): Promise<Array<{
    eventId: string;
    eventType: string;
    provider: string;
    status: string;
    receivedAt: string;
  }>>;
}

export class PaymentsService {
  constructor(
    private provider: PaymentProvider,
    private settleDeps: {
      settleOrderPaid: (tx: Tx, args: { orderId: string; tenantId: string; providerRef: string | null; correlationId?: string | null; memo?: string }) => Promise<{ orderPublicId: string }>;
      settleInvoicePaid: (tx: Tx, args: { invoiceId: string; tenantId: string; providerRef: string | null; correlationId?: string | null }) => Promise<unknown>;
      settleInvoiceFailed: (tx: Tx, args: { invoiceId: string; tenantId: string; failureCode: string; correlationId?: string | null }) => Promise<void>;
    }
  ) {}

  // -------------------------------------------------------------------------
  // Provider config (secrets live ONLY here + the ingress — never the core)
  // -------------------------------------------------------------------------

  async ensureProviderConfig(providerId = this.provider.id) {
    const existing = await db.erpProviderConfig.findUnique({ where: { id: providerId } });
    if (existing) return { providerId, enabled: existing.enabled };
    const created = await db.erpProviderConfig.create({
      data: { id: providerId, enabled: true, secret: ulid() + ulid() }, // 52+ chars of entropy
    });
    return { providerId, enabled: created.enabled };
  }

  private async getProviderSecret(providerId = this.provider.id): Promise<string> {
    const cfg = await db.erpProviderConfig.findUnique({ where: { id: providerId } });
    if (!cfg?.enabled || !cfg.secret) {
      throw new ErpError("PROVIDER_ERROR", "Payment provider is not configured.");
    }
    return cfg.secret;
  }

  async signDelivery(rawBody: string, timestamp: string, providerId = this.provider.id): Promise<string> {
    const secret = await this.getProviderSecret(providerId);
    return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  }

  // -------------------------------------------------------------------------
  // Webhook ingress (verify, store, acknowledge fast — never business logic)
  // -------------------------------------------------------------------------

  async ingestSignedEvent(args: {
    rawBody: string;
    signature: string;
    timestamp: string;
    providerId?: string;
  }): Promise<IngestResult> {
    const providerId = args.providerId ?? this.provider.id;
    const secret = await this.getProviderSecret(providerId);

    const ts = Number(args.timestamp);
    if (!Number.isFinite(ts)) {
      throw new ErpError("VALIDATION", "Invalid webhook timestamp.");
    }
    const tsMs = ts < 1e12 ? ts * 1000 : ts;
    if (Math.abs(Date.now() - tsMs) > WEBHOOK_MAX_AGE_MS) {
      throw new ErpError("VALIDATION", "Webhook timestamp is stale (replay protection).");
    }

    // Verify the signature against the RAW body BEFORE any parsing.
    const expected = Buffer.from(
      createHmac("sha256", secret).update(`${args.timestamp}.${args.rawBody}`).digest("hex"),
      "hex"
    );
    const received = /^[0-9a-f]{64}$/i.test(args.signature)
      ? Buffer.from(args.signature.toLowerCase(), "hex")
      : Buffer.alloc(0);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ErpError("VALIDATION", "Invalid webhook signature.");
    }

    let event: { eventId?: string; eventType?: string; payload?: Record<string, unknown> };
    try {
      event = JSON.parse(args.rawBody);
    } catch {
      throw new ErpError("VALIDATION", "Invalid webhook JSON.");
    }
    if (!event.eventId || !event.eventType) {
      throw new ErpError("VALIDATION", "Webhook payload must carry eventId and eventType.");
    }

    // Insert-or-ignore on (provider, event_id): duplicates are acknowledged
    // with no change (failure handling: duplicate webhook -> no change).
    try {
      await db.erpWebhookEvent.create({
        data: {
          provider: providerId,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: args.rawBody,
          status: "RECEIVED",
        },
      });
      return { accepted: true, duplicate: false, eventId: event.eventId };
    } catch (err) {
      if (err instanceof Error && (err.message.includes("Unique constraint") || err.message.includes("P2002"))) {
        return { accepted: true, duplicate: true, eventId: event.eventId };
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Provider execution (outside any transaction)
  // -------------------------------------------------------------------------

  async submitAttempt(attemptPublicId: string, provider: PaymentProvider = this.provider) {
    const attempt = await db.erpPayAttempt.findUnique({ where: { publicId: attemptPublicId } });
    if (!attempt) throw new ErpError("NOT_FOUND", "Payment attempt not found.");
    if (attempt.status !== "INITIATED") {
      throw new ErpError("STATE_CONFLICT", `Attempt is ${attempt.status}, not INITIATED.`);
    }

    // Conditional flip INITIATED -> SUBMITTED (two workers can't both submit).
    const flipped = await db.erpPayAttempt.updateMany({
      where: { id: attempt.id, status: "INITIATED" },
      data: { status: "SUBMITTED" },
    });
    if (flipped.count === 0) {
      throw new ErpError("STATE_CONFLICT", "Attempt already submitted.");
    }

    // The method's token reference is the ONLY credential passed on.
    const method = await db.erpPaymentMethod.findUnique({ where: { id: attempt.methodId } });
    if (!method || method.status !== "ACTIVE") {
      await this.markAttemptFailed(attempt.id, "method_unavailable");
      throw new ErpError("CONSENT_REQUIRED", "The payment method is inactive or missing.");
    }

    // PROVIDER CALL — outside any transaction, using the STORED key so every
    // retry of this attempt returns the original result (layer 5).
    const result = await provider.charge({
      providerIdemKey: attempt.providerIdemKey,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      tokenRef: method.tokenRef,
      description: `ERP attempt ${attempt.publicId}`,
    });

    if (result.status === "UNKNOWN") {
      // Timeout: the attempt moves to UNKNOWN (after the grace window the
      // sweeper re-queries the provider by reference or replays the call).
      await db.erpPayAttempt.updateMany({
        where: { id: attempt.id, status: "SUBMITTED" },
        data: { status: "UNKNOWN", providerRef: result.providerRef },
      });
    }

    return {
      attemptPublicId,
      providerStatus: result.status,
      providerRef: result.providerRef,
    };
  }

  private async markAttemptFailed(attemptId: string, failureCode: string): Promise<void> {
    await db.erpPayAttempt.updateMany({
      where: { id: attemptId, status: { in: ["INITIATED", "SUBMITTED", "UNKNOWN"] } },
      data: { status: "FAILED", activeSlot: null, failureCode },
    });
  }

  // -------------------------------------------------------------------------
  // Worker jobs
  // -------------------------------------------------------------------------

  /** Deliver provider events for in-flight attempts. The mock provider
   *  re-emits events on every call (same idempotency key -> original result),
   *  and ingestSignedEvent dedupes — modelling real providers retrying
   *  delivery up to 12 times until acknowledged. */
  async deliverPendingProviderEvents(provider: PaymentProvider = this.provider): Promise<{ delivered: number }> {
    const attempts = await db.erpPayAttempt.findMany({
      where: { status: { in: ["SUBMITTED", "UNKNOWN"] }, updatedAt: { lt: new Date(Date.now() + 1000) } },
      orderBy: { updatedAt: "asc" },
      take: 25,
    });
    let delivered = 0;
    for (const attempt of attempts) {
      // Replay the provider call with the SAME stored key (idempotent).
      const result = await provider.charge({
        providerIdemKey: attempt.providerIdemKey,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        tokenRef: await this.tokenRefFor(attempt.methodId),
        description: `ERP attempt ${attempt.publicId}`,
      });

      // A timed-out call becomes UNKNOWN once the grace window passes.
      if (result.status === "UNKNOWN" && attempt.status === "SUBMITTED") {
        await db.erpPayAttempt.updateMany({
          where: { id: attempt.id, status: "SUBMITTED", updatedAt: { lt: new Date(Date.now() - UNKNOWN_AFTER_MS) } },
          data: { status: "UNKNOWN", providerRef: result.providerRef },
        });
      }

      const events = provider.eventsFor(result, attempt.publicId, {
        providerIdemKey: attempt.providerIdemKey,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        tokenRef: await this.tokenRefFor(attempt.methodId),
      });
      for (const evt of events) {
        const body = JSON.stringify(evt);
        const timestamp = String(Date.now());
        const signature = await this.signDelivery(body, timestamp, provider.id);
        const ingest = await this.ingestSignedEvent({ rawBody: body, signature, timestamp, providerId: provider.id });
        if (!ingest.duplicate) delivered += 1;
      }
    }
    return { delivered };
  }

  private async tokenRefFor(methodId: string): Promise<string> {
    const method = await db.erpPaymentMethod.findUnique({ where: { id: methodId } });
    return method?.tokenRef ?? "tok_unknown";
  }

  /** Settle every RECEIVED webhook event (Transaction B). */
  async processReceivedEvents(provider: PaymentProvider = this.provider): Promise<WorkerTickReport> {
    const events = await db.erpWebhookEvent.findMany({
      where: { status: "RECEIVED", provider: provider.id },
      orderBy: { receivedAt: "asc" },
      take: 25,
    });
    const report: WorkerTickReport = { delivered: 0, processed: 0, failed: 0, swept: 0, requeued: 0 };

    for (const eventRow of events) {
      let outcome: "processed" | "requeued" | "failed" = "requeued";
      try {
        outcome = await this.settleReceivedEvent(eventRow);
      } catch {
        outcome = "requeued"; // webhook-before-commit: retried with backoff
      }
      if (outcome === "processed") report.processed += 1;
      else if (outcome === "failed") report.failed += 1;
      else report.requeued += 1;
    }
    return report;
  }

  /** Transaction B — settle one received event. Returns the outcome; any
   *  thrown error leaves the event RECEIVED (retry with backoff). */
  private async settleReceivedEvent(
    eventRow: { id: string; eventId: string; eventType: string; payload: string; provider: string }
  ): Promise<"processed" | "requeued" | "failed"> {
    return db.$transaction(async (tx) => {
      // Consumer dedupe (at-least-once delivery): a duplicate event commits
      // nothing and exits as processed.
      const isNew = await claimInboxEvent(tx, WORKER_CONSUMER, eventRow.eventId);
      if (!isNew) {
        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
        return "processed" as const;
      }

      let parsed: {
        eventId?: string;
        eventType?: string;
        payload?: { data?: { id?: string; attributes?: { metadata?: { attempt_public_id?: string }; failure_code?: string; amount?: number; currency?: string } } };
      };
      try {
        parsed = JSON.parse(eventRow.payload);
      } catch {
        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "FAILED" } });
        return "failed" as const;
      }

      const attemptPublicId = parsed.payload?.data?.attributes?.metadata?.attempt_public_id;
      const providerRef = parsed.payload?.data?.id ?? null;
      if (!attemptPublicId) {
        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "FAILED" } });
        return "failed" as const;
      }

      const attempt = await tx.erpPayAttempt.findUnique({ where: { publicId: attemptPublicId } });
      if (!attempt) {
        // Webhook arrives before our commit: the event carries our attempt
        // public_id in metadata; if the row is not visible yet the event
        // stays RECEIVED and is retried with backoff (blueprint failure #3).
        throw new ErpError("NOT_FOUND", "Attempt not visible yet.");
      }

      if (attempt.status === "SUCCEEDED") {
        // Duplicate paid event: state machine treats SUCCEEDED->SUCCEEDED as
        // a no-op; the handler still acknowledges (blueprint failure #2).
        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
        return "processed" as const;
      }

      if (eventRow.eventType === "payment.paid") {
        // Amount/currency guard: a mismatched amount is flagged MISMATCH,
        // nothing is fulfilled, finance is alerted (blueprint failure #6).
        const eventAmount = parsed.payload?.data?.attributes?.amount;
        const eventCurrency = parsed.payload?.data?.attributes?.currency;
        if (
          (typeof eventAmount === "number" && eventAmount !== attempt.amountMinor) ||
          (typeof eventCurrency === "string" && eventCurrency !== attempt.currency)
        ) {
          await tx.erpPayAttempt.update({
            where: { id: attempt.id },
            data: { status: "FAILED", activeSlot: null, failureCode: "MISMATCH" },
          });
          await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "FAILED" } });
          return "failed" as const;
        }

        // Set attempt SUCCEEDED + clear active_slot (conditional: the slot is
        // only cleared from a live attempt; final attempts never collide).
        const settled = await tx.erpPayAttempt.updateMany({
          where: { id: attempt.id, status: { in: ["SUBMITTED", "UNKNOWN"] } },
          data: { status: "SUCCEEDED", activeSlot: null, providerRef, failureCode: null },
        });
        if (settled.count === 0) {
          // Lost the race (e.g. a concurrent settlement or a FAILED flip).
          await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
          return "processed" as const;
        }

        if (attempt.payableType === "ORDER") {
          // State conflict (payment lands after expiry) bubbles up -> the
          // event stays RECEIVED for the refund/re-reserve saga (roadmap;
          // documented in docs/erp/PAYMENTS.md failure matrix).
          await this.settleDeps.settleOrderPaid(tx, {
            orderId: attempt.payableId,
            tenantId: attempt.tenantId,
            providerRef,
            memo: `Settled via provider event ${eventRow.eventId}`,
          });
        } else {
          await this.settleDeps.settleInvoicePaid(tx, {
            invoiceId: attempt.payableId,
            tenantId: attempt.tenantId,
            providerRef,
          });
        }

        await recordOutboxEvent(tx, {
          def: ERP_EVENTS.paymentSucceeded,
          tenantId: attempt.tenantId,
          aggregateId: attempt.payableId,
          payload: {
            attemptPublicId: attempt.publicId,
            payableType: attempt.payableType,
            payableId: attempt.payableId,
            amountMinor: attempt.amountMinor,
            providerRef,
          },
        });

        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
        return "processed" as const;
      }

      if (eventRow.eventType === "payment.failed") {
        const failureCode = parsed.payload?.data?.attributes?.failure_code ?? "provider_declined";
        const flipped = await tx.erpPayAttempt.updateMany({
          where: { id: attempt.id, status: { in: ["SUBMITTED", "UNKNOWN"] } },
          data: { status: "FAILED", activeSlot: null, failureCode },
        });
        await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
        if (flipped.count === 0) return "processed" as const;

        if (attempt.payableType === "INVOICE") {
          await this.settleDeps.settleInvoiceFailed(tx, {
            invoiceId: attempt.payableId,
            tenantId: attempt.tenantId,
            failureCode,
          });
        }
        // Shop orders stay open until expiry so the student can try another
        // method (blueprint failure #4) — nothing else to do here.
        await recordOutboxEvent(tx, {
          def: ERP_EVENTS.paymentFailed,
          tenantId: attempt.tenantId,
          aggregateId: attempt.payableId,
          payload: {
            attemptPublicId: attempt.publicId,
            payableType: attempt.payableType,
            payableId: attempt.payableId,
            failureCode,
          },
        });
        return "processed" as const;
      }

      // Unknown event type: never return an error that would trigger provider
      // retries forever — acknowledge and store (blueprint: webhook trust).
      await tx.erpWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "PROCESSED" } });
      return "processed" as const;
    });
  }

  /** Sweeper: resolve attempts stuck in SUBMITTED/UNKNOWN for > 5 minutes. */
  async sweepStuckAttempts(provider: PaymentProvider = this.provider): Promise<{ swept: number }> {
    const stuck = await db.erpPayAttempt.findMany({
      where: {
        status: { in: ["SUBMITTED", "UNKNOWN"] },
        updatedAt: { lt: new Date(Date.now() - STUCK_ATTEMPT_MS) },
      },
      orderBy: { updatedAt: "asc" },
      take: 25,
    });
    let swept = 0;
    for (const attempt of stuck) {
      // Re-query the provider by reference (or replay the call with the same
      // idempotency key, which returns the original result). No new attempt
      // may start while one is in flight (uq_one_in_flight holds).
      const result = await provider.resolveUnknown(
        attempt.providerRef ?? attempt.providerIdemKey,
        attempt.providerIdemKey
      );
      const events = provider.eventsFor(result, attempt.publicId, {
        providerIdemKey: attempt.providerIdemKey,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        tokenRef: await this.tokenRefFor(attempt.methodId),
      });
      for (const evt of events) {
        const body = JSON.stringify(evt);
        const timestamp = String(Date.now());
        const signature = await this.signDelivery(body, timestamp, provider.id);
        await this.ingestSignedEvent({ rawBody: body, signature, timestamp, providerId: provider.id });
      }
      swept += 1;
    }
    return { swept };
  }

  // -------------------------------------------------------------------------
  // Push-mode renewal (membership auto-debit)
  // -------------------------------------------------------------------------

  async startInvoiceAttempt(args: {
    invoiceId: string;
    tenantId: string;
    methodId: string;
    amountMinor: number;
    currency?: string;
  }) {
    assertAmountMinor(args.amountMinor, "invoice amount");
    const attemptPublicId = ulid();

    const created = await db.$transaction(async (tx) => {
      const last = await tx.erpPayAttempt.findFirst({
        where: { payableType: "INVOICE", payableId: args.invoiceId },
        orderBy: { attemptNo: "desc" },
        select: { attemptNo: true },
      });
      const attempt = await tx.erpPayAttempt.create({
        data: {
          publicId: attemptPublicId,
          tenantId: args.tenantId,
          payableType: "INVOICE",
          payableId: args.invoiceId,
          attemptNo: (last?.attemptNo ?? 0) + 1,
          methodId: args.methodId,
          amountMinor: args.amountMinor,
          currency: args.currency ?? "PHP",
          status: "INITIATED",
          activeSlot: 1,
          providerIdemKey: `pay_${attemptPublicId}`,
        },
      });
      return attempt;
    });
    void created;

    const submitted = await this.submitAttempt(attemptPublicId);
    return { attemptPublicId, providerStatus: submitted.providerStatus };
  }

  async listRecentAttempts(limit = 20) {
    const rows = await db.erpPayAttempt.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((a) => ({
      publicId: a.publicId,
      payableType: a.payableType,
      payableId: a.payableId,
      attemptNo: a.attemptNo,
      status: a.status,
      amountMinor: a.amountMinor,
      providerRef: a.providerRef,
      updatedAt: a.updatedAt.toISOString(),
    }));
  }

  async listRecentWebhookEvents(limit = 20) {
    const rows = await db.erpWebhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((e) => ({
      eventId: e.eventId,
      eventType: e.eventType,
      provider: e.provider,
      status: e.status,
      receivedAt: e.receivedAt.toISOString(),
    }));
  }
}
