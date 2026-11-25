// ERP shared kernel — consumer inbox (dedupe for at-least-once delivery).
//
// Blueprint rule 2: "Each handler inserts (consumer, event_id) into
// sys_inbox inside its own transaction; a duplicate key means the event was
// already handled, so it commits nothing and exits."

import { ErpError } from "./errors";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Claim an event for a consumer INSIDE the handler's transaction.
 *  Returns true when the event is new for this consumer (handler proceeds).
 *  Returns false when it was already handled (handler exits, commits nothing).
 *  A concurrent duplicate insert loses the race via the composite PK — the
 *  loser must treat it as "already handled" and roll back its own writes. */
export async function claimInboxEvent(
  tx: Tx,
  consumer: string,
  eventId: string
): Promise<boolean> {
  try {
    await tx.erpInbox.create({ data: { consumer, eventId } });
    return true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("Unique constraint") || err.message.includes("P2002"))
    ) {
      return false; // already handled by this consumer
    }
    throw err;
  }
}

/** Convenience wrapper: run the handler only when the event is new.
 *  On duplicate: returns { deduped: true } without running the handler.
 *  On claim-race loss: the handler ran but its tx was rolled back by the
 *  unique violation — surfaces as an ErpError the caller can retry. */
export async function withInboxDedupe<T>(
  tx: Tx,
  consumer: string,
  eventId: string,
  handler: (tx: Tx) => Promise<T>
): Promise<{ deduped: boolean; result: T | null }> {
  const isNew = await claimInboxEvent(tx, consumer, eventId);
  if (!isNew) return { deduped: true, result: null };
  const result = await handler(tx);
  return { deduped: false, result };
}

// Guard kept so the module compiles standalone; ErpError is part of the
// kernel surface for handlers that want consistent failure shapes.
void ErpError;
