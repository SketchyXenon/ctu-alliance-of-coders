"use client";

import * as React from "react";
import {
  Activity,
  BookOpenText,
  CheckCircle2,
  Coins,
  Landmark,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * ErpPanel — admin dev console for the Campus Shop & Membership module.
 *
 * Watches the whole payment path end-to-end (blueprint "Deployment and
 * operations" observability targets):
 *   - ledger balance check (the nightly job, surfaced live)
 *   - outbox lag (NEW rows awaiting the relay)
 *   - payment attempts + provider webhook events
 *   - one-click: seed demo data, run a shop checkout, subscribe a membership,
 *     and run the worker tick (deliver -> settle Txn B -> sweep).
 */

// Mirrors the GET /api/erp/status payload.
interface ErpStatus {
  orders: Array<{
    id: string;
    publicId: string;
    status: string;
    totalMinor: number;
    currency: string;
    buyerRef: string;
    createdAt: string;
  }>;
  attempts: Array<{
    publicId: string;
    payableType: string;
    attemptNo: number;
    status: string;
    amountMinor: number;
    providerRef: string | null;
    updatedAt: string;
  }>;
  invoices: Array<{
    id: string;
    membershipId: string;
    amountMinor: number;
    status: string;
    dueAt: string;
  }>;
  memberships: Array<{
    id: string;
    publicId: string;
    memberRef: string;
    status: string;
  }>;
  plans: Array<{ id: string; name: string; amountMinor: number; period: string; active: boolean }>;
  catalog: Array<{
    id: string;
    name: string;
    status: string;
    variants: Array<{ id: string; sku: string; unitPriceMinor: number }>;
  }>;
  outbox: { new: number; sent: number };
  webhookEvents: Array<{
    eventId: string;
    eventType: string;
    provider: string;
    status: string;
    receivedAt: string;
  }>;
  ledger: { debitMinor: number; creditMinor: number; balanced: boolean };
  providerEnabled: boolean;
}

function formatMoney(minor: number, currency = "PHP"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${currency} ${(Math.floor(abs / 100)).toLocaleString("en-PH")}.${String(abs % 100).padStart(2, "0")}`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PAID":
    case "SUCCEEDED":
    case "ACTIVE":
    case "PROCESSED":
      return "border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300";
    case "PENDING_PAYMENT":
    case "SUBMITTED":
    case "INITIATED":
    case "SCHEDULED":
    case "RECEIVED":
    case "PENDING":
    case "SENT":
      return "border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300";
    case "FAILED":
    case "EXPIRED":
    case "CANCELLED":
    case "LAPSED":
      return "border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300";
    default:
      return "text-muted-foreground";
  }
}

export function ErpPanel() {
  const [status, setStatus] = React.useState<ErpStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [booting, setBooting] = React.useState(false);
  const [ticking, setTicking] = React.useState(false);
  const [checkingOut, setCheckingOut] = React.useState(false);
  const [subscribing, setSubscribing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await api.get<{ data: ErpStatus }>("/api/erp/status");
    if (error || !data) {
      setLoadError(error?.message ?? "Failed to load ERP status.");
      setLoading(false);
      return;
    }
    setStatus(data.data);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleBootstrap() {
    setBooting(true);
    const { data, error } = await api.post<{ ok: boolean; result: { planName: string; variantSku: string; methodsCreated: number } }>(
      "/api/erp/bootstrap"
    );
    setBooting(false);
    if (error || !data) {
      toast.error("Bootstrap failed", { description: error?.message });
      return;
    }
    toast.success("ERP demo data ready", {
      description: `${data.result.variantSku} + "${data.result.planName}" + ${data.result.methodsCreated} saved method(s).`,
    });
    void load();
  }

  async function handleTick() {
    setTicking(true);
    const { data, error } = await api.post<{
      ok: boolean;
      tick: { processed: number; delivered: number; relay: { relayed: number }; swept: number; invoicesCharged: number; requeued: number };
    }>("/api/erp/worker");
    setTicking(false);
    if (error || !data) {
      toast.error("Worker tick failed", { description: error?.message });
      return;
    }
    const t = data.tick;
    toast.success("Worker tick complete", {
      description: `Settled ${t.processed} · delivered ${t.delivered} · relayed ${t.relay.relayed} · swept ${t.swept} · renewals ${t.invoicesCharged}${t.requeued ? ` · requeued ${t.requeued}` : ""}`,
    });
    void load();
  }

  async function handleCheckout() {
    const variant = status?.catalog.flatMap((c) => c.variants)[0];
    if (!variant) {
      toast.error("No product to check out", { description: "Run Bootstrap demo data first." });
      return;
    }
    setCheckingOut(true);
    const { data, error } = await api.post<{
      order?: { publicId: string; totalMinor: number };
      attempt?: { publicId: string; providerStatus: string };
    }>("/api/erp/checkout", { mode: "shop", variantId: variant.id, qty: 1 }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
    setCheckingOut(false);
    if (error || !data) {
      toast.error("Checkout failed", { description: error?.message });
      void load();
      return;
    }
    toast.success(`Order ${shortId(data.order?.publicId ?? "")} placed`, {
      description: `Attempt ${shortId(data.attempt?.publicId ?? "")}: provider ${data.attempt?.providerStatus ?? "?"}. Run the worker tick to settle.`,
    });
    void load();
  }

  async function handleSubscribe() {
    const plan = status?.plans.find((p) => p.active);
    if (!plan) {
      toast.error("No active plan", { description: "Run Bootstrap demo data first." });
      return;
    }
    setSubscribing(true);
    const { data, error } = await api.post<{ invoiceId: string; attempt?: { attemptPublicId: string; providerStatus: string } }>(
      "/api/erp/checkout",
      { mode: "membership", planId: plan.id },
      { headers: { "Idempotency-Key": crypto.randomUUID() } }
    );
    setSubscribing(false);
    if (error || !data) {
      toast.error("Subscribe failed", { description: error?.message });
      void load();
      return;
    }
    toast.success("Membership subscribed", {
      description: `Invoice ${shortId(data.invoiceId)} + attempt ${shortId(data.attempt?.attemptPublicId ?? "")}: provider ${data.attempt?.providerStatus ?? "?"}.`,
    });
    void load();
  }

  return (
    <div className="space-y-5">
      {/* Intro + actions */}
      <Card className="border-border/60 bg-primary/5">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Landmark className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-display text-base font-semibold">ERP Module — Campus Shop &amp; Membership</p>
            <p className="text-sm text-muted-foreground">
              Modular-monolith blueprint (docs/erp/): catalog, inventory, orders, membership,
              billing, payments, ledger. Settlement runs through a signed provider webhook +
              worker tick (Transaction B) — every step is idempotent and audit-logged.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleBootstrap()} disabled={booting}>
              {booting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
              Seed demo data
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => void handleTick()} disabled={ticking}>
              {ticking ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PlayCircle className="size-3.5" aria-hidden="true" />}
              Run worker tick
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading ERP status...
        </div>
      ) : loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-destructive">
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
            {loadError}
            <Button variant="outline" size="sm" onClick={() => void load()} className="ml-auto">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : status ? (
        <>
          {/* Money-path demo actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="size-4 text-primary" aria-hidden="true" />
                Money-path demo
              </CardTitle>
              <CardDescription className="text-xs">
                Each action runs Transaction A (order/invoice + reservation + INITIATED attempt),
                calls the mock provider, and leaves settlement to the signed webhook + worker tick
                (Transaction B). Use the Activity tab to see the audit trail.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleCheckout()} disabled={checkingOut || !status.catalog.length}>
                {checkingOut ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Coins className="size-3.5" aria-hidden="true" />}
                Checkout shirt (PHP 350)
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleSubscribe()} disabled={subscribing || !status.plans.some((p) => p.active)}>
                {subscribing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Users className="size-3.5" aria-hidden="true" />}
                Subscribe monthly plan (PHP 50)
              </Button>
            </CardContent>
          </Card>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={<Landmark className="size-4" aria-hidden="true" />}
              label="Ledger"
              value={status.ledger.balanced ? "Balanced" : "UNBALANCED"}
              hint={`${formatMoney(status.ledger.debitMinor)} debits`}
              ok={status.ledger.balanced}
            />
            <KpiCard
              icon={<Activity className="size-4" aria-hidden="true" />}
              label="Outbox lag"
              value={`${status.outbox.new} new`}
              hint={`${status.outbox.sent} relayed`}
              ok={status.outbox.new <= 5}
            />
            <KpiCard
              icon={<ShieldCheck className="size-4" aria-hidden="true" />}
              label="Provider"
              value={status.providerEnabled ? "Mock enabled" : "Disabled"}
              hint="keys held by worker/ingress only"
              ok={status.providerEnabled}
            />
            <KpiCard
              icon={<BookOpenText className="size-4" aria-hidden="true" />}
              label="Memberships"
              value={String(status.memberships.length)}
              hint={`${status.memberships.filter((m) => m.status === "ACTIVE").length} active`}
              ok={true}
            />
          </div>

          {/* Orders */}
          <DataTableCard
            title="Orders (ord_orders)"
            icon={<ShoppingCart className="size-4 text-primary" aria-hidden="true" />}
            headers={["Order", "Status", "Total", "Buyer", "Created"]}
            rows={status.orders.map((o) => [
              <code key="id" className="font-mono text-[11px]">{shortId(o.publicId)}</code>,
              <Badge key="s" variant="outline" className={cn("gap-1", statusBadgeClass(o.status))}>{o.status}</Badge>,
              <span key="t">{formatMoney(o.totalMinor, o.currency)}</span>,
              <span key="b" className="text-muted-foreground">{shortId(o.buyerRef)}</span>,
              <span key="c" className="text-muted-foreground">{new Date(o.createdAt).toLocaleString("en-PH")}</span>,
            ])}
            empty="No orders yet — run a checkout above."
            maxHeightClass="max-h-64"
          />

          {/* Payment attempts */}
          <DataTableCard
            title="Payment attempts (pay_attempts)"
            icon={<Coins className="size-4 text-primary" aria-hidden="true" />}
            headers={["Attempt", "Payable", "No.", "Status", "Amount"]}
            rows={status.attempts.map((a) => [
              <code key="id" className="font-mono text-[11px]">{shortId(a.publicId)}</code>,
              <span key="t">{a.payableType}</span>,
              <span key="n">{a.attemptNo}</span>,
              <Badge key="s" variant="outline" className={cn("gap-1", statusBadgeClass(a.status))}>{a.status}</Badge>,
              <span key="a">{formatMoney(a.amountMinor)}</span>,
            ])}
            empty="No payment attempts yet."
            maxHeightClass="max-h-64"
          />

          {/* Invoices */}
          <DataTableCard
            title="Invoices (bil_invoices)"
            icon={<BookOpenText className="size-4 text-primary" aria-hidden="true" />}
            headers={["Invoice", "Status", "Amount", "Due"]}
            rows={status.invoices.map((i) => [
              <code key="id" className="font-mono text-[11px]">{shortId(i.id)}</code>,
              <Badge key="s" variant="outline" className={cn("gap-1", statusBadgeClass(i.status))}>{i.status}</Badge>,
              <span key="a">{formatMoney(i.amountMinor)}</span>,
              <span key="d" className="text-muted-foreground">{new Date(i.dueAt).toLocaleString("en-PH")}</span>,
            ])}
            empty="No invoices yet — subscribe a membership above."
            maxHeightClass="max-h-64"
          />

          {/* Provider webhook events */}
          <DataTableCard
            title="Provider webhook events (pay_webhook_events)"
            icon={<ShieldCheck className="size-4 text-primary" aria-hidden="true" />}
            headers={["Event", "Type", "Provider", "Status", "Received"]}
            rows={status.webhookEvents.map((e) => [
              <code key="id" className="font-mono text-[11px]">{shortId(e.eventId)}</code>,
              <span key="t">{e.eventType}</span>,
              <span key="p" className="text-muted-foreground">{e.provider}</span>,
              <Badge key="s" variant="outline" className={cn("gap-1", statusBadgeClass(e.status))}>{e.status}</Badge>,
              <span key="r" className="text-muted-foreground">{new Date(e.receivedAt).toLocaleTimeString("en-PH")}</span>,
            ])}
            empty="No provider events yet — the webhook ingress stores signed deliveries."
            maxHeightClass="max-h-64"
          />
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  ok: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          )}
        >
          {ok ? <CheckCircle2 className="size-4" aria-hidden="true" /> : icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-display text-base font-semibold leading-tight">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DataTableCard({
  title,
  icon,
  headers,
  rows,
  empty,
  maxHeightClass,
}: {
  title: string;
  icon: React.ReactNode;
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  maxHeightClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className={cn("overflow-y-auto", maxHeightClass)}>
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((cells, i) => (
                  <TableRow key={i}>
                    {cells.map((cell, j) => (
                      <TableCell key={j} className="text-xs">
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
