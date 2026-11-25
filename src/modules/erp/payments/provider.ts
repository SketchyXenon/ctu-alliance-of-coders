// ERP Payments module — PaymentProvider port.
//
// Blueprint: "PayMongo as the reference adapter (one-time: cards and
// e-wallets; recurring: cards and Maya) behind a PaymentProvider port. The
// port keeps Xendit, HitPay or Maya swappable." In this sandbox blueprint the
// MockPaymentProvider implements the port; production adapters implement the
// same interface without touching any caller.

export interface ProviderChargeInput {
  /** Deterministic idempotency key (pay_{attempt_public_id}) — stored BEFORE
   *  the call and reused on every retry of that attempt (layer 5). */
  providerIdemKey: string;
  amountMinor: number;
  currency: string;
  /** The provider token reference from pay_methods (never raw card data). */
  tokenRef: string;
  /** Human-readable description for the provider receipt. */
  description?: string;
}

export type ProviderChargeStatus = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface ProviderChargeResult {
  status: ProviderChargeStatus;
  providerRef: string | null;
  failureCode: string | null;
  /** True when the result came from a replayed idempotency key. */
  replayed: boolean;
}

/** The signed event a provider would deliver to the Webhook Ingress. */
export interface ProviderEvent {
  eventId: string;
  eventType: "payment.paid" | "payment.failed" | "payment.unknown";
  /** JSON payload — carries our attempt public_id in metadata (blueprint:
   *  "The event carries our attempt public_id in its metadata"). */
  payload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: string;
  /** Execute a charge. Implementations MUST be safe to retry with the same
   *  providerIdemKey (the provider returns the original result on a repeat). */
  charge(input: ProviderChargeInput): Promise<ProviderChargeResult>;
  /** Produce the event(s) the provider would send for a charge result. */
  eventsFor(charge: ProviderChargeResult, attemptPublicId: string, input: ProviderChargeInput): ProviderEvent[];
  /** Re-query a possibly-unknown charge by reference (sweeper path). */
  resolveUnknown(providerRef: string, providerIdemKey: string): Promise<ProviderChargeResult>;
}
