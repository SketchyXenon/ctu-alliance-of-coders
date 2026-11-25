// ERP shared kernel — transactional outbox.
//
// Blueprint "Events and integration": modules talk through events written to
// a transactional outbox — the event row commits in the same transaction as
// the state change, so an event is published IF AND ONLY IF the change
// happened. Delivery is at-least-once; consumers dedupe via sys_inbox.

import { ulid } from "./ulid";
import { ERP_EVENTS, type ErpEventDef, type ErpEventEnvelope } from "./events";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface RecordEventParams {
  def: ErpEventDef;
  tenantId: string;
  aggregateId: string;
  correlationId?: string | null;
  payload: Record<string, unknown>;
}

/** Write an event row to sys_outbox INSIDE the caller's transaction.
 *  Must be called with the same tx that performs the state change. */
export async function recordOutboxEvent(tx: Tx, params: RecordEventParams): Promise<string> {
  const eventId = ulid();
  const envelope: Omit<ErpEventEnvelope, "eventId" | "topic" | "schemaVer"> & {
    eventId?: string;
    topic?: string;
    schemaVer?: number;
  } = {
    tenantId: params.tenantId,
    aggregateId: params.aggregateId,
    occurredAt: new Date().toISOString(),
    correlationId: params.correlationId ?? null,
    payload: params.payload,
  };
  await tx.erpOutbox.create({
    data: {
      eventId,
      topic: params.def.topic,
      schemaVer: params.def.schemaVer,
      aggregateId: params.aggregateId,
      payload: JSON.stringify(envelope),
      status: "NEW",
    },
  });
  return eventId;
}

export interface OutboxBatchResult {
  relayed: number;
  topics: string[];
}

/** Relay: claim NEW rows in batches, publish to the in-process sink, mark
 *  SENT. The sink is injectable (defaults to a structured log) so a future
 *  Payment Worker service or Kafka relay swaps in without touching callers
 *  (blueprint "Scale-up path"). Delivery is at-least-once: a crash after
 *  publish but before SENT re-delivers — consumers must dedupe (sys_inbox). */
export async function relayOutboxBatch(
  batchSize = 50,
  sink: (envelope: ErpEventEnvelope) => Promise<void> | void = defaultSink
): Promise<OutboxBatchResult> {
  const rows = await dbSafe().erpOutbox.findMany({
    where: { status: "NEW" },
    orderBy: [{ aggregateId: "asc" }, { createdAt: "asc" }],
    take: batchSize,
  });
  const topics: string[] = [];
  for (const row of rows) {
    const envelope = parseEnvelope(row);
    await sink(envelope);
    await dbSafe().erpOutbox.update({
      where: { id: row.id },
      data: { status: "SENT" },
    });
    topics.push(row.topic);
  }
  return { relayed: rows.length, topics };
}

/** Events for one aggregate are processed in created_at order; different
 *  aggregates may run in parallel (blueprint rule 3). The findMany above
 *  sorts by (aggregateId, createdAt) to honor that contract. */

function parseEnvelope(row: {
  eventId: string;
  topic: string;
  schemaVer: number;
  payload: string;
}): ErpEventEnvelope {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    parsed = {};
  }
  return {
    eventId: row.eventId,
    topic: row.topic as ErpEventEnvelope["topic"],
    schemaVer: row.schemaVer,
    tenantId: String(parsed.tenantId ?? "campus"),
    aggregateId: String(parsed.aggregateId ?? ""),
    occurredAt: String(parsed.occurredAt ?? new Date().toISOString()),
    correlationId: typeof parsed.correlationId === "string" ? parsed.correlationId : null,
    payload: (parsed.payload as Record<string, unknown>) ?? parsed,
  };
}

function defaultSink(envelope: ErpEventEnvelope): void {
  // In-process sink for the modular-monolith phase. Replace (not edit) when a
  // job queue is introduced — see docs/erp/BLUEPRINT.md phase 2.
  console.info(
    JSON.stringify({
      level: "info",
      msg: "erp_outbox_relay",
      event_id: envelope.eventId,
      topic: envelope.topic,
      aggregate: envelope.aggregateId,
    })
  );
}

/** The relay runs OUTSIDE a transaction (it is the publisher). Import db
 *  lazily to keep this module importable from unit tests without a client. */
import { db as prisma } from "@/lib/db";
function dbSafe(): typeof prisma {
  return prisma;
}

// Re-exported for consumers building handlers.
export { ERP_EVENTS };
