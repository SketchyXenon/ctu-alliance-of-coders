// ERP module registry — the single public surface of the ERP module.
//
// Import rules (enforced by tests/erp-boundaries.test.ts):
//   - Route handlers and other app code import ONLY from "@/modules/erp"
//     (this file) — never from a module's internals.
//   - Module services import ONLY: their own folder, ../shared/*, and
//     "@/lib/db". Cross-module calls are wired in container.ts.
//   - Each export here is a typed interface; implementation classes stay
//     private to their folders (extraction-ready per the blueprint).

export const ERP_MODULE_VERSION = "1.0.0";

// Public API types (the contracts other code is allowed to depend on).
export type {
  ProductView,
  VariantView,
  CreateProductInput,
  CatalogApi,
} from "./catalog/catalog.service";
export type { StockView, ReservationItem, InventoryApi } from "./inventory/inventory.service";
export type { PlaceOrderInput, OrderView, OrdersApi } from "./orders/orders.service";
export { ORDER_RESERVATION_TTL_MS } from "./orders/orders.service";
export type { MembershipView, MembershipApi } from "./membership/membership.service";
export type { InvoiceView, BillingApi } from "./billing/billing.service";
export { INVOICE_LEASE_MS } from "./billing/billing.service";
export type { PaymentsApi, WorkerTickReport, IngestResult } from "./payments/payments.service";
export type {
  PaymentProvider,
  ProviderChargeInput,
  ProviderChargeResult,
  ProviderEvent,
} from "./payments/provider";
export type { LedgerApi, JournalInput, JournalLineInput } from "./ledger/ledger.service";
export type { WorkerTickResult } from "./worker";
export { ERP_EVENTS, type ErpEventEnvelope, type ErpEventTopic } from "./shared/events";
export { ErpError, erpErrorToResponse, type ErpErrorCode } from "./shared/errors";
export {
  formatMinor,
  lineTotalMinor,
  assertAmountMinor,
  ERP_CURRENCY,
  MoneyError,
} from "./shared/money";
export { ulid, isUlid } from "./shared/ulid";
export { fingerprintRequest, runIdempotent } from "./shared/idempotency";
export { MockPaymentProvider } from "./payments/mock-provider";
export { seedErpDemo, type ErpBootstrapResult } from "./bootstrap";

// The wired container (singleton). Route handlers call `erp.orders.placeOrder`
// etc. — never a module's internals directly.
export { erp } from "./container";
export { runWorkerTick } from "./worker";
