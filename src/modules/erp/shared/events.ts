// ERP shared kernel — event catalog (single source of truth for topics).
//
// Blueprint "Events and integration": every event carries event_id, topic,
// schema_ver, tenant_id, occurred_at, correlation_id and a payload of IDs and
// facts — never another module's full record. New fields are additive; a
// breaking change publishes to a new schema_ver beside the old one.

export interface ErpEventDef {
  topic: string;
  schemaVer: number;
  publisher: "identity" | "catalog" | "inventory" | "orders" | "membership" | "billing" | "payments" | "ledger";
}

export const ERP_EVENTS = {
  userRegistered: { topic: "identity.user_registered", schemaVer: 1, publisher: "identity" },
  roleChanged: { topic: "identity.role_changed", schemaVer: 1, publisher: "identity" },
  productPublished: { topic: "catalog.product_published", schemaVer: 1, publisher: "catalog" },
  priceChanged: { topic: "catalog.price_changed", schemaVer: 1, publisher: "catalog" },
  stockReserved: { topic: "inventory.stock_reserved", schemaVer: 1, publisher: "inventory" },
  stockReleased: { topic: "inventory.stock_released", schemaVer: 1, publisher: "inventory" },
  stockLow: { topic: "inventory.stock_low", schemaVer: 1, publisher: "inventory" },
  orderPlaced: { topic: "orders.order_placed", schemaVer: 1, publisher: "orders" },
  orderPaid: { topic: "orders.order_paid", schemaVer: 1, publisher: "orders" },
  orderExpired: { topic: "orders.order_expired", schemaVer: 1, publisher: "orders" },
  membershipActivated: { topic: "membership.membership_activated", schemaVer: 1, publisher: "membership" },
  membershipLapsed: { topic: "membership.membership_lapsed", schemaVer: 1, publisher: "membership" },
  invoiceDue: { topic: "billing.invoice_due", schemaVer: 1, publisher: "billing" },
  invoicePaid: { topic: "billing.invoice_paid", schemaVer: 1, publisher: "billing" },
  invoiceFailed: { topic: "billing.invoice_failed", schemaVer: 1, publisher: "billing" },
  paymentSucceeded: { topic: "payments.payment_succeeded", schemaVer: 1, publisher: "payments" },
  paymentFailed: { topic: "payments.payment_failed", schemaVer: 1, publisher: "payments" },
  refundCompleted: { topic: "payments.refund_completed", schemaVer: 1, publisher: "payments" },
  journalPosted: { topic: "ledger.journal_posted", schemaVer: 1, publisher: "ledger" },
} as const satisfies Record<string, ErpEventDef>;

export type ErpEventTopic = (typeof ERP_EVENTS)[keyof typeof ERP_EVENTS]["topic"];

export interface ErpEventEnvelope {
  eventId: string; // ULID, also the consumer's dedupe key
  topic: ErpEventTopic;
  schemaVer: number;
  tenantId: string;
  aggregateId: string; // ordering key (order, invoice, membership)
  occurredAt: string; // ISO
  correlationId: string | null; // originating request trace
  payload: Record<string, unknown>; // IDs and facts, never a full foreign record
}
