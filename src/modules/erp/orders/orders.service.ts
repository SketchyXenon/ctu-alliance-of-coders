// ERP Orders module (ord_) — cart, order lifecycle, pickup/claim codes.
// Publishes: OrderPlaced, OrderPaid, OrderExpired.
// Consumes: PaymentSucceeded, PaymentFailed (via the payments module calling
// this module's settlement interface inside ITS transaction).
//
// Blueprint "Checkout and auto-debit flow":
//   Transaction A (reserve and record intent) — insert idempotency row, create
//   the order PENDING_PAYMENT with a 15-minute expiry, reserve stock with
//   conditional updates, insert the pay_attempts row as INITIATED with its
//   provider key, write OrderPlaced to the outbox. Commit.
//
// The provider call happens OUTSIDE any transaction (payments module).
// Transaction B (settle on payment.paid) is orders.settleOrderPaid, called
// by the payments module inside ITS transaction.

import { ulid } from "../shared/ulid";
import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { lineTotalMinor, assertAmountMinor } from "../shared/money";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const ORDER_RESERVATION_TTL_MS = 15 * 60_000; // blueprint: 15-minute expiry

export interface PlaceOrderInput {
  tenantId: string;
  orgId: string;
  buyerRef: string;
  correlationId?: string | null;
  items: Array<{ variantId: string; qty: number; unitPriceMinor: number }>;
  /** The payment method row id (pay_methods.id) chosen for this order. */
  methodId: string;
  /** Deterministic provider idempotency key for the FIRST attempt.
   *  The caller supplies the attempt public id it already committed to (it
   *  derives the provider key from it), or this service generates one. */
  attemptPublicId?: string;
  providerIdemKey: string;
}

export interface OrderView {
  id: string;
  publicId: string;
  status: string;
  totalMinor: number;
  currency: string;
  expiresAt: string;
  buyerRef: string;
  createdAt: string;
}

export interface OrdersApi {
  /** Transaction A. Runs the whole reserve-and-record-intent step in ONE
   *  transaction: order + stock reservations + INITIATED pay attempt +
   *  OrderPlaced outbox. Throws SOLD_OUT / IN_FLIGHT on guarded paths. */
  placeOrder(input: PlaceOrderInput): Promise<{ order: OrderView; attemptPublicId: string }>;
  /** Transaction B (order side). Called by the payments module inside its
   *  settlement transaction: order -> PAID (conditional), commit stock
   *  reservations, post the sales journal, write OrderPaid to the outbox. */
  settleOrderPaid(
    tx: Tx,
    args: { orderId: string; tenantId: string; providerRef: string | null; correlationId?: string | null; memo?: string }
  ): Promise<{ orderPublicId: string }>;
  /** Sweeper: expire PENDING_PAYMENT orders past their deadline (release stock). */
  expireStaleOrders(): Promise<{ expired: number }>;
  listRecentOrders(limit?: number): Promise<OrderView[]>;
}

export class OrdersService {
  constructor(
    private inventory: InventoryDeps,
    private ledger: LedgerDeps
  ) {}

  async placeOrder(input: PlaceOrderInput): Promise<{ order: OrderView; attemptPublicId: string }> {
    if (!input.items.length) {
      throw new ErpError("VALIDATION", "An order needs at least one item.");
    }
    let totalMinor = 0;
    for (const item of input.items) {
      totalMinor += lineTotalMinor(item.unitPriceMinor, item.qty);
    }
    assertAmountMinor(totalMinor, "order total");
    const expiresAt = new Date(Date.now() + ORDER_RESERVATION_TTL_MS);
    const attemptPublicId = input.attemptPublicId ?? ulid();

    const order = await db.$transaction(async (tx) => {
      // Guard: one in-flight attempt per order is enforced at the attempt
      // level (uq_one_in_flight); a fresh order always starts at attempt 1.
      const orderRow = await tx.erpOrder.create({
        data: {
          publicId: ulid(),
          tenantId: input.tenantId,
          orgId: input.orgId,
          buyerRef: input.buyerRef,
          status: "PENDING_PAYMENT",
          totalMinor,
          currency: "PHP",
          expiresAt,
        },
      });

      // Reserve stock with conditional updates (same transaction — blueprint
      // rule 1: one short transaction per business step).
      await this.inventory.reserveStock(tx, {
        tenantId: input.tenantId,
        orderId: orderRow.id,
        items: input.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
        correlationId: input.correlationId ?? null,
      });

      // Record the payment intent BEFORE any provider call (layer 5: the
      // deterministic provider key is stored before the call and reused on
      // every retry of this attempt).
      await tx.erpPayAttempt.create({
        data: {
          publicId: attemptPublicId,
          tenantId: input.tenantId,
          payableType: "ORDER",
          payableId: orderRow.id,
          attemptNo: 1,
          methodId: input.methodId,
          amountMinor: totalMinor,
          currency: "PHP",
          status: "INITIATED",
          activeSlot: 1,
          providerIdemKey: input.providerIdemKey,
        },
      });

      await recordOutboxEvent(tx, {
        def: ERP_EVENTS.orderPlaced,
        tenantId: input.tenantId,
        aggregateId: orderRow.id,
        correlationId: input.correlationId ?? null,
        payload: {
          orderPublicId: orderRow.publicId,
          totalMinor,
          attemptPublicId,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return toOrderView(orderRow);
    });

    return { order, attemptPublicId };
  }

  async settleOrderPaid(
    tx: Tx,
    args: { orderId: string; tenantId: string; providerRef: string | null; correlationId?: string | null; memo?: string }
  ): Promise<{ orderPublicId: string }> {
    const order = await tx.erpOrder.findUnique({ where: { id: args.orderId } });
    if (!order) throw new ErpError("NOT_FOUND", "Order not found.");

    if (order.status === "PAID") {
      // Duplicate settlement: state machine treats SUCCEEDED->SUCCEEDED as a
      // no-op (blueprint failure handling: duplicate webhook -> no change).
      return { orderPublicId: order.publicId };
    }
    if (order.status !== "PENDING_PAYMENT") {
      // Payment lands after the order expired/cancelled — the payments module
      // handles re-reserve-or-refund; here we surface the conflict.
      throw new ErpError("STATE_CONFLICT", `Order is ${order.status}, not PENDING_PAYMENT.`);
    }

    // Conditional update: PAID only WHERE status = 'PENDING_PAYMENT'
    const updated = await tx.erpOrder.updateMany({
      where: { id: args.orderId, status: "PENDING_PAYMENT" },
      data: { status: "PAID", version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ErpError("STATE_CONFLICT", "Order state changed during settlement.");
    }

    // Commit the reservation: decrement on_hand + reserved.
    await this.inventory.commitReservations(tx, args.orderId);

    // Post the balanced sales journal (cash up, revenue up).
    await this.ledger.postJournal(tx, {
      tenantId: args.tenantId,
      orgId: order.orgId,
      memo: args.memo ?? `Sales settlement for order ${order.publicId}`,
      correlationId: args.correlationId ?? null,
      lines: [
        { accountCode: "1000-CASH", debitMinor: order.totalMinor, creditMinor: 0 },
        { accountCode: "4000-SALES", debitMinor: 0, creditMinor: order.totalMinor },
      ],
    });

    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.orderPaid,
      tenantId: args.tenantId,
      aggregateId: args.orderId,
      correlationId: args.correlationId ?? null,
      payload: { orderPublicId: order.publicId, totalMinor: order.totalMinor, providerRef: args.providerRef },
    });

    return { orderPublicId: order.publicId };
  }

  async expireStaleOrders(): Promise<{ expired: number }> {
    const stale = await db.erpOrder.findMany({
      where: { status: "PENDING_PAYMENT", expiresAt: { lt: new Date() } },
      select: { id: true, tenantId: true, publicId: true },
      take: 100,
    });
    let expired = 0;
    for (const order of stale) {
      await db.$transaction(async (tx) => {
        const updated = await tx.erpOrder.updateMany({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { status: "EXPIRED", version: { increment: 1 } },
        });
        if (updated.count === 0) return;
        await this.inventory.releaseReservations(tx, {
          tenantId: order.tenantId,
          orderId: order.id,
        });
        await recordOutboxEvent(tx, {
          def: ERP_EVENTS.orderExpired,
          tenantId: order.tenantId,
          aggregateId: order.id,
          payload: { orderPublicId: order.publicId },
        });
        expired += 1;
      });
    }
    return { expired };
  }

  async listRecentOrders(limit = 20): Promise<OrderView[]> {
    const rows = await db.erpOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toOrderView);
  }
}

function toOrderView(row: {
  id: string;
  publicId: string;
  status: string;
  totalMinor: number;
  currency: string;
  expiresAt: Date;
  buyerRef: string;
  createdAt: Date;
}): OrderView {
  return {
    id: row.id,
    publicId: row.publicId,
    status: row.status,
    totalMinor: row.totalMinor,
    currency: row.currency,
    expiresAt: row.expiresAt.toISOString(),
    buyerRef: row.buyerRef,
    createdAt: row.createdAt.toISOString(),
  };
}

// Structural dep shapes (kept minimal so the container wires implementations,
// not classes — cross-module calls go through the public interface only).
// Shapes are declared LOCALLY: modules do not even type-import each other's
// files; the composition root guarantees shape compatibility.
interface InventoryDeps {
  reserveStock: (tx: Tx, args: { tenantId: string; orderId: string; items: Array<{ variantId: string; qty: number }>; correlationId?: string | null }) => Promise<unknown>;
  commitReservations: (tx: Tx, orderId: string) => Promise<unknown>;
  releaseReservations: (tx: Tx, args: { tenantId: string; orderId: string; correlationId?: string | null }) => Promise<unknown>;
}
interface LedgerDeps {
  postJournal: (tx: Tx, input: {
    tenantId: string;
    orgId: string;
    memo: string;
    correlationId?: string | null;
    lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }>;
  }) => Promise<unknown>;
}
