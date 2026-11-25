// ERP shared kernel — module error taxonomy.
// Route handlers translate these to HTTP responses; modules never throw raw
// strings. Codes mirror the blueprint's API error contract.

export type ErpErrorCode =
  | "VALIDATION" // 400
  | "SOLD_OUT" // 409 — zero rows affected on the conditional stock update
  | "IN_FLIGHT" // 409 — an attempt is already active for the payable
  | "IDEMPOTENCY_REPLAY" // 200 (handled by withIdempotency, surfaced here)
  | "IDEMPOTENCY_CONFLICT" // 422 — same key, different body
  | "IDEMPOTENCY_IN_PROGRESS" // 409 — same key still running
  | "NOT_FOUND" // 404
  | "STATE_CONFLICT" // 409 — invalid state-machine transition
  | "MISMATCH" // 422 — amount/currency differs from the attempt (manual review)
  | "UNBALANCED_JOURNAL" // 500 — ledger guard, never committed
  | "CONSENT_REQUIRED" // 403 — no recorded mandate for the method
  | "PROVIDER_ERROR"; // 502 — provider call failed

const STATUS_BY_CODE: Record<ErpErrorCode, number> = {
  VALIDATION: 400,
  SOLD_OUT: 409,
  IN_FLIGHT: 409,
  IDEMPOTENCY_REPLAY: 200,
  IDEMPOTENCY_CONFLICT: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  MISMATCH: 422,
  UNBALANCED_JOURNAL: 500,
  CONSENT_REQUIRED: 403,
  PROVIDER_ERROR: 502,
};

export class ErpError extends Error {
  readonly code: ErpErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErpErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ErpError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/** Map any thrown value to a safe HTTP status + message for route handlers.
 *  Unknown errors collapse to a generic 500 (no internals leaked). */
export function erpErrorToResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ErpError) {
    return { status: err.status, body: { error: err.message } };
  }
  if (err instanceof Error && err.name === "MoneyError") {
    return { status: 400, body: { error: err.message } };
  }
  // Prisma unique-violation on guarded inserts (P2002): the database rejected
  // a double-charge / double-invoice path — the strongest correctness guard.
  if (
    err instanceof Error &&
    (err.message.includes("Unique constraint") || err.message.includes("P2002"))
  ) {
    return { status: 409, body: { error: "Duplicate request rejected by a database invariant." } };
  }
  return { status: 500, body: { error: "ERP module error. Please try again later." } };
}
