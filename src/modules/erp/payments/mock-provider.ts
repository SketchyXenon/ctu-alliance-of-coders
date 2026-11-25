// ERP Payments module — MockPaymentProvider (sandbox reference adapter).
//
// Deterministic behavior so the whole money path is testable offline:
//   - tokenRef "tok_fail"          -> FAILED (insufficient_funds)
//   - tokenRef "tok_timeout"       -> UNKNOWN (simulates a provider timeout;
//                                     the sweeper resolves via the same
//                                     idempotency key, returning the original
//                                     result — no second charge)
//   - anything else                -> SUCCEEDED
// The provider NEVER sees raw card data — only token references (blueprint:
// card data scope). The signed-event helper produces payloads exactly like a
// real provider's webhook delivery, bound to our attempt public_id.

import { randomUUID } from "node:crypto";
import type {
  PaymentProvider,
  ProviderChargeInput,
  ProviderChargeResult,
  ProviderEvent,
} from "./provider";

// The mock keeps a tiny in-memory ledger of idempotency results so a retry
// with the same key returns the ORIGINAL result (mirrors PayMongo's contract:
// "returns the original result on a repeat"). Scoped per-process — exactly
// the guarantee the real provider gives across its fleet.
const results = new Map<string, ProviderChargeResult>();

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";

  async charge(input: ProviderChargeInput): Promise<ProviderChargeResult> {
    const existing = results.get(input.providerIdemKey);
    if (existing) {
      return { ...existing, replayed: true };
    }
    let result: ProviderChargeResult;
    if (input.tokenRef === "tok_fail") {
      result = { status: "FAILED", providerRef: `mock_${randomUUID().slice(0, 8)}`, failureCode: "insufficient_funds", replayed: false };
    } else if (input.tokenRef === "tok_timeout") {
      result = { status: "UNKNOWN", providerRef: `mock_${randomUUID().slice(0, 8)}`, failureCode: null, replayed: false };
    } else {
      result = { status: "SUCCEEDED", providerRef: `mock_${randomUUID().slice(0, 8)}`, failureCode: null, replayed: false };
    }
    results.set(input.providerIdemKey, result);
    return result;
  }

  async resolveUnknown(providerRef: string, providerIdemKey: string): Promise<ProviderChargeResult> {
    // Real providers expose a GET /payments/{ref}. The mock replays the
    // stored result for the same idempotency key — proving the sweeper path
    // (re-query by reference, or replay the call with the same key) can never
    // double-charge.
    const existing = results.get(providerIdemKey);
    if (existing) return { ...existing, replayed: true };
    return { status: "SUCCEEDED", providerRef, failureCode: null, replayed: false };
  }

  eventsFor(charge: ProviderChargeResult, attemptPublicId: string, input: ProviderChargeInput): ProviderEvent[] {
    if (charge.status === "UNKNOWN") {
      // The provider has not decided yet — no event is delivered; the sweeper
      // resolves the attempt later.
      return [];
    }
    const type = charge.status === "SUCCEEDED" ? "payment.paid" : "payment.failed";
    return [
      {
        eventId: `evt_${randomUUID()}`,
        eventType: type,
        payload: {
          data: {
            id: charge.providerRef,
            type,
            status: charge.status.toLowerCase(),
            amount: input.amountMinor,
            currency: input.currency,
            description: input.description ?? null,
            attributes: {
              // Our metadata travels with the event (webhook-before-commit
              // handling: the event carries the attempt public_id).
              metadata: { attempt_public_id: attemptPublicId, idempotency_key: input.providerIdemKey },
              failure_code: charge.failureCode,
            },
          },
        },
      },
    ];
  }
}
