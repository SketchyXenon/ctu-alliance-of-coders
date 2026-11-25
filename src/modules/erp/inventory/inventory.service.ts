// ERP Inventory module (inv_) — stock levels, reservations, movements.
// Publishes: StockReserved, StockReleased, StockLow.
// Consumes: OrderPlaced, OrderExpired, PaymentSucceeded (via orders/payments
// calling this module's public interface inside their transactions).
//
// Blueprint design rule 3: "Prefer atomic conditional updates for counters.
// Stock reservation is UPDATE inv_stock SET reserved = reserved + ? WHERE
// variant_id = ? AND on_hand - reserved >= ?; zero rows affected means sold
// out. No read-then-write race exists."
//
// The counter updates use ONE parameterized raw statement each (the blueprint
// explicitly prefers plain SQL for money paths — conditional updates stay
// visible and reviewable). Values are interpolated through Prisma's tagged
// template, which binds them as parameters — never string-concatenated.

import { db } from "@/lib/db";
import { recordOutboxEvent } from "../shared/outbox";
import { ERP_EVENTS } from "../shared/events";
import { ErpError } from "../shared/errors";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface ReservationItem {
  variantId: string;
  qty: number;
}

export interface StockView {
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface InventoryApi {
  /** Seed or adjust a stock counter (admin bootstrap, deliveries). */
  upsertStock(variantId: string, onHand: number): Promise<StockView>;
  getStock(variantId: string): Promise<StockView>;
  /** Atomically reserve stock for an order INSIDE the caller's transaction.
   *  Applies the conditional update per line in variant_id order (fixed lock
   *  order — blueprint rule 4) so two transactions cannot deadlock.
   *  Throws SOLD_OUT when any line has insufficient availability; the whole
   *  transaction then rolls back — nothing is half-applied. */
  reserveStock(
    tx: Tx,
    args: { tenantId: string; orderId: string; items: ReservationItem[]; correlationId?: string | null }
  ): Promise<{ reserved: ReservationItem[] }>;
  /** Commit reservations on successful payment (decrement on_hand + reserved). */
  commitReservations(tx: Tx, orderId: string): Promise<{ committed: number }>;
  /** Release reservations (order expired / cancelled). */
  releaseReservations(
    tx: Tx,
    args: { tenantId: string; orderId: string; correlationId?: string | null }
  ): Promise<{ released: number }>;
}

const LOW_STOCK_THRESHOLD = 5;

export class InventoryService implements InventoryApi {
  async upsertStock(variantId: string, onHand: number): Promise<StockView> {
    if (!Number.isInteger(onHand) || onHand < 0) {
      throw new ErpError("VALIDATION", "on_hand must be a non-negative integer.");
    }
    const row = await db.erpStock.upsert({
      where: { variantId },
      update: { onHand },
      create: { variantId, onHand, reserved: 0 },
    });
    return toStockView(row);
  }

  async getStock(variantId: string): Promise<StockView> {
    const row = await db.erpStock.findUnique({ where: { variantId } });
    if (!row) return { variantId, onHand: 0, reserved: 0, available: 0 };
    return toStockView(row);
  }

  async reserveStock(
    tx: Tx,
    args: { tenantId: string; orderId: string; items: ReservationItem[]; correlationId?: string | null }
  ): Promise<{ reserved: ReservationItem[] }> {
    if (!args.items.length) {
      throw new ErpError("VALIDATION", "At least one reservation item is required.");
    }
    // Fixed lock order: sort by variantId so concurrent orders touch rows in
    // the same sequence (blueprint design rule 4).
    const items = [...args.items].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
    for (const item of items) {
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) {
        throw new ErpError("VALIDATION", "qty must be an integer between 1 and 100.");
      }
    }

    for (const item of items) {
      // Atomic conditional update — the ONLY correct way to reserve against a
      // counter. Zero rows affected means sold out; the caller's transaction
      // then rolls back as a whole.
      const updated = await tx.$executeRaw(
        Prisma.sql`UPDATE inv_stock
                   SET reserved = reserved + ${item.qty}
                   WHERE variant_id = ${item.variantId}
                     AND on_hand - reserved >= ${item.qty}`
      );
      if (updated === 0) {
        throw new ErpError("SOLD_OUT", "Insufficient stock for one or more items.", {
          variantId: item.variantId,
          qty: item.qty,
        });
      }
    }

    await tx.erpReservation.createMany({
      data: items.map((item) => ({
        orderId: args.orderId,
        variantId: item.variantId,
        qty: item.qty,
        status: "HELD",
      })),
    });

    await recordOutboxEvent(tx, {
      def: ERP_EVENTS.stockReserved,
      tenantId: args.tenantId,
      aggregateId: args.orderId,
      correlationId: args.correlationId ?? null,
      payload: { orderId: args.orderId, items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) },
    });

    // Low-stock signal (informational; published after the reservation).
    for (const item of items) {
      const row = await tx.erpStock.findUnique({ where: { variantId: item.variantId } });
      if (row && row.onHand - row.reserved <= LOW_STOCK_THRESHOLD) {
        await recordOutboxEvent(tx, {
          def: ERP_EVENTS.stockLow,
          tenantId: args.tenantId,
          aggregateId: item.variantId,
          correlationId: args.correlationId ?? null,
          payload: { variantId: item.variantId, available: row.onHand - row.reserved },
        });
      }
    }

    return { reserved: items };
  }

  async commitReservations(tx: Tx, orderId: string): Promise<{ committed: number }> {
    const reservations = await tx.erpReservation.findMany({
      where: { orderId, status: "HELD" },
    });
    // Same fixed lock order for the counter updates.
    for (const res of reservations.sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE inv_stock
                   SET on_hand = on_hand - ${res.qty},
                       reserved = reserved - ${res.qty}
                   WHERE variant_id = ${res.variantId}`
      );
    }
    await tx.erpReservation.updateMany({
      where: { orderId, status: "HELD" },
      data: { status: "COMMITTED" },
    });
    return { committed: reservations.length };
  }

  async releaseReservations(
    tx: Tx,
    args: { tenantId: string; orderId: string; correlationId?: string | null }
  ): Promise<{ released: number }> {
    const reservations = await tx.erpReservation.findMany({
      where: { orderId: args.orderId, status: "HELD" },
    });
    for (const res of reservations.sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE inv_stock
                   SET reserved = reserved - ${res.qty}
                   WHERE variant_id = ${res.variantId}`
      );
    }
    await tx.erpReservation.updateMany({
      where: { orderId: args.orderId, status: "HELD" },
      data: { status: "RELEASED" },
    });
    if (reservations.length > 0) {
      await recordOutboxEvent(tx, {
        def: ERP_EVENTS.stockReleased,
        tenantId: args.tenantId,
        aggregateId: args.orderId,
        correlationId: args.correlationId ?? null,
        payload: { orderId: args.orderId, releasedQty: reservations.reduce((s, r) => s + r.qty, 0) },
      });
    }
    return { released: reservations.length };
  }
}

function toStockView(row: { variantId: string; onHand: number; reserved: number }): StockView {
  return { ...row, available: row.onHand - row.reserved };
}
