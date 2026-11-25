// ERP composition root — the ONLY file allowed to import across module
// folders (boundary rule 2). Services receive their collaborators as
// constructor dependencies shaped by each module's PUBLIC interface, so a
// module can later be extracted into its own service behind the same
// interface without touching its consumers.
//
// billing <-> membership are mutually dependent (billing settles invoices ->
// activates membership; membership subscribes -> creates the first invoice).
// The cycle is broken with deferred closures: the wrappers dereference the
// collaborator at CALL time, not construction time.

import { CatalogService } from "./catalog/catalog.service";
import { InventoryService } from "./inventory/inventory.service";
import { OrdersService } from "./orders/orders.service";
import { MembershipService } from "./membership/membership.service";
import { BillingService } from "./billing/billing.service";
import { PaymentsService } from "./payments/payments.service";
import { LedgerService } from "./ledger/ledger.service";
import { MockPaymentProvider } from "./payments/mock-provider";

const catalog = new CatalogService();
const inventory = new InventoryService();
const ledger = new LedgerService();

// Orders consumes inventory (reserve/commit/release) + ledger (journal).
const orders = new OrdersService(
  {
    reserveStock: (tx, args) => inventory.reserveStock(tx, args),
    commitReservations: (tx, orderId) => inventory.commitReservations(tx, orderId),
    releaseReservations: (tx, args) => inventory.releaseReservations(tx, args),
  },
  {
    postJournal: (tx, input) => ledger.postJournal(tx, input),
  }
);

// Deferred reference breaks the billing <-> membership cycle: the wrappers
// dereference the collaborator at CALL time, not construction time.
const membershipRef: { current: MembershipService | null } = { current: null };

// Billing consumes ledger (journal) + membership (activate/lapse on settle).
const billing = new BillingService(
  {
    postJournal: (tx, input) => ledger.postJournal(tx, input),
  },
  {
    activateMembership: (tx, args) => membershipRef.current!.activateMembership(tx, args),
    lapseMembership: (tx, args) => membershipRef.current!.lapseMembership(tx, args),
  }
);

// Membership consumes billing (first invoice per period on subscribe).
const membership = new MembershipService({
  ensureInvoiceForPeriod: (args) => billing.ensureInvoiceForPeriod(args),
});
membershipRef.current = membership;

// Payments consumes the settlement callbacks of orders + billing. Settlement
// runs in the PAYMENTS transaction (Txn B), calling the target module's
// transaction-safe interface with the same tx handle.
const provider = new MockPaymentProvider();
const payments = new PaymentsService(provider, {
  settleOrderPaid: (tx, args) => orders.settleOrderPaid(tx, args),
  settleInvoicePaid: (tx, args) => billing.settleInvoicePaid(tx, args),
  settleInvoiceFailed: (tx, args) => billing.settleInvoiceFailed(tx, args),
});

export const erp = {
  catalog,
  inventory,
  ledger,
  orders,
  billing,
  membership,
  payments,
  provider,
};

export type ErpContainer = typeof erp;
