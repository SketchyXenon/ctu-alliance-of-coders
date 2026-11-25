// ERP shared kernel — API idempotency middleware (correctness layer 3).
//
// Blueprint "Debounce, idempotency and ACID" layer 3: a required
// Idempotency-Key header; a row in api_idempotency_keys is inserted inside
// the business transaction.
//   - same key + same body  -> replay the stored response (200)
//   - same key + different body -> 422
//   - same key still running    -> 409 with Retry-After
// Layers 1 (browser debounce) and 2 (Redis debounce) are UX/noise reducers
// documented in docs/erp/BLUEPRINT.md; layers 4-6 live in the payments module.

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ErpError } from "./errors";

const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000; // blueprint: now + 48 h

export function fingerprintRequest(method: string, path: string, body: string): string {
  return createHash("sha256").update(`${method}:${path}:${body}`).digest("hex");
}

export interface IdempotencyResult<T> {
  replayed: boolean;
  result: T | null;
  storedResponse: { code: number; body: unknown } | null;
}

interface RunIdempotentOptions<T> {
  scope: string; // caller identity + route, e.g. "admin-1:checkout"
  idemKey: string;
  fingerprint: string;
  /** Runs the business flow and returns the response to store for replays. */
  run: () => Promise<{ code: number; body: T }>;
}

/** Guard a business flow with an idempotency key (claim-then-finalize).
 *  The claim row is created up front (unique on scope+key), the flow runs,
 *  and the stored response is written on completion — so a later retry with
 *  the same key + body replays the stored response without re-running.
 *  A failed flow releases the claim so a corrected retry can proceed; a
 *  crashed flow's stale claim is taken over after 2 minutes (self-healing). */
export async function runIdempotent<T>(
  opts: RunIdempotentOptions<T>
): Promise<IdempotencyResult<T>> {
  if (!opts.idemKey || typeof opts.idemKey !== "string" || opts.idemKey.length > 200) {
    throw new ErpError("VALIDATION", "A valid Idempotency-Key header is required.");
  }

  const existing = await db.erpIdempotencyKey.findUnique({
    where: { scope_idemKey: { scope: opts.scope, idemKey: opts.idemKey } },
  });

  if (existing) {
    if (existing.fingerprint !== opts.fingerprint) {
      throw new ErpError(
        "IDEMPOTENCY_CONFLICT",
        "This Idempotency-Key was already used with a different request body.",
        { idemKey: opts.idemKey }
      );
    }
    if (existing.status === "COMPLETED") {
      return {
        replayed: true,
        result: null,
        storedResponse: {
          code: existing.responseCode ?? 200,
          body: existing.responseBody ? JSON.parse(existing.responseBody) : null,
        },
      };
    }
    // Stale claim takeover: a crashed flow leaves IN_PROGRESS forever; after
    // 2 minutes the claim is released so a retry can proceed (self-healing).
    const stale = Date.now() - new Date(existing.createdAt).getTime() > 2 * 60_000;
    if (!stale) {
      throw new ErpError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical request is still in progress. Retry shortly.",
        { idemKey: opts.idemKey }
      );
    }
    await db.erpIdempotencyKey.delete({ where: { id: existing.id } });
  }

  // Claim: create the IN_PROGRESS row. Concurrent claims lose on the unique
  // key and surface as IN_PROGRESS after re-reading.
  try {
    await db.erpIdempotencyKey.create({
      data: {
        scope: opts.scope,
        idemKey: opts.idemKey,
        fingerprint: opts.fingerprint,
        status: "IN_PROGRESS",
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  } catch {
    const loser = await db.erpIdempotencyKey.findUnique({
      where: { scope_idemKey: { scope: opts.scope, idemKey: opts.idemKey } },
    });
    if (loser?.fingerprint === opts.fingerprint) {
      throw new ErpError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical request is still in progress. Retry shortly.",
        { idemKey: opts.idemKey }
      );
    }
    throw new ErpError(
      "IDEMPOTENCY_CONFLICT",
      "This Idempotency-Key was already used with a different request body.",
      { idemKey: opts.idemKey }
    );
  }

  try {
    const { code, body } = await opts.run();
    await db.erpIdempotencyKey.update({
      where: { scope_idemKey: { scope: opts.scope, idemKey: opts.idemKey } },
      data: {
        status: "COMPLETED",
        responseCode: code,
        responseBody: JSON.stringify(body ?? null),
      },
    });
    return { replayed: false, result: body, storedResponse: null };
  } catch (err) {
    // The flow failed: release the claim so a corrected retry can proceed.
    await db.erpIdempotencyKey
      .deleteMany({
        where: { scope: opts.scope, idemKey: opts.idemKey, status: "IN_PROGRESS" },
      })
      .catch(() => undefined);
    throw err;
  }
}

/** Expire stale idempotency rows (worker maintenance job). */
export async function purgeExpiredIdempotencyKeys(): Promise<number> {
  const res = await db.erpIdempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}
