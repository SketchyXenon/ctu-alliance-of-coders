"use client";

import * as React from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// Shared status shape (mirrors IntegrationStatus from src/lib/integrations.ts;
// redeclared here to keep the client bundle free of server-only imports).
interface IntegrationStatus {
  id: string;
  label: string;
  desc: string;
  icon: string;
  kind: "webhook" | "outbound_api";
  enabled: boolean;
  secretPreview: string | null;
  config: Record<string, string>;
  updatedAt: string | null;
}

interface IntegrationField {
  name: string;
  label: string;
  type: "text" | "url" | "secret" | "channel";
  required: boolean;
  placeholder?: string;
  help?: string;
  maxLen: number;
}

interface IntegrationDef {
  id: string;
  label: string;
  desc: string;
  icon: string;
  kind: "webhook" | "outbound_api";
  fields: IntegrationField[];
}

const EMAIL_INTEGRATION_ID = "email";

/**
 * IntegrationsPanel - admin catalog of external integrations.
 *
 * Each integration card shows live status (Enabled / Disabled / Not configured)
 * and a primary action. Webhook + outbound_api integrations are fully
 * configurable here; the Email integration stays on its existing status/test
 * flow (kept in this file for backward compatibility with the catalog layout).
 *
 * Per 05-ui-ux-design.md:
 *   - section 4: full state set for every interactive element (hover, focus,
 *     active, disabled, loading).
 *   - section 5: icons support labels, never replace them.
 *   - section 6: success/error feedback via toasts; destructive clear uses a
 *     confirm dialog.
 */
export function IntegrationsPanel() {
  const [statuses, setStatuses] = React.useState<IntegrationStatus[]>([]);
  const [defs, setDefs] = React.useState<IntegrationDef[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<{ items: IntegrationStatus[] }>(
      "/api/integrations",
    );
    if (error || !data) {
      setError(error?.message ?? "Failed to load integrations.");
      setLoading(false);
      return;
    }
    setStatuses(data.items.filter((s) => s.id !== EMAIL_INTEGRATION_ID));
    setDefs(
      data.items
        .filter((s) => s.id !== EMAIL_INTEGRATION_ID)
        .map((s) => ({
          id: s.id,
          label: s.label,
          desc: s.desc,
          icon: s.icon,
          kind: s.kind,
          // Fields aren't returned by the API (they're a server concern). The
          // dialog fetches them lazily on open via the same shape we mirror
          // below from the constants module. To avoid a second round-trip we
          // hardcode the field schemas here, matching src/lib/integrations.ts.
          fields: FIELD_SCHEMAS[s.id] ?? [],
        })),
    );
    setLoading(false);
  }

  React.useEffect(() => {
    void load();
  }, []);

  function patchStatus(updated: IntegrationStatus) {
    setStatuses((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div className="space-y-5">
      <Card className="border-border/60 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LucideIcons.Webhook className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-base font-semibold">
              Integration Catalog
            </p>
            <p className="text-sm text-muted-foreground">
              Connect external services to automate announcements and sync data.
              The Webhook integration is fully functional; others are
              configurable with credentials stored securely server-side.
            </p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading integrations...
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-destructive">
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            {error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="ml-auto"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {defs.map((def) => {
            const status = statuses.find((s) => s.id === def.id);
            return (
              <IntegrationCard
                key={def.id}
                def={def}
                status={status ?? null}
                onUpdated={patchStatus}
                onRefresh={load}
              />
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Need a custom integration? Reach out via the contact form and we&apos;ll
        scope it with you.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field schemas (mirror src/lib/integrations.ts so the client can render the
// config form without a second API round-trip). Kept in sync manually.
// ---------------------------------------------------------------------------
const FIELD_SCHEMAS: Record<string, IntegrationField[]> = {
  webhook: [],
  discord: [
    {
      name: "botToken",
      label: "Bot Token",
      type: "secret",
      required: true,
      placeholder: "MTk4NjIy...",
      help: "From the Discord Developer Portal > Bot > Reset Token.",
      maxLen: 1024,
    },
    {
      name: "channelId",
      label: "Channel ID",
      type: "channel",
      required: true,
      placeholder: "123456789012345678",
      help: "Enable Developer Mode in Discord, right-click the channel > Copy ID.",
      maxLen: 64,
    },
  ],
  "google-workspace": [
    {
      name: "accessToken",
      label: "OAuth Access Token",
      type: "secret",
      required: true,
      placeholder: "ya29...",
      help: "Service-account or OAuth token with calendar.readonly scope.",
      maxLen: 1024,
    },
    {
      name: "calendarId",
      label: "Calendar ID",
      type: "text",
      required: true,
      placeholder: "primary",
      help: "The calendar ID to read events from (often an email address).",
      maxLen: 500,
    },
  ],
  facebook: [
    {
      name: "pageAccessToken",
      label: "Page Access Token",
      type: "secret",
      required: true,
      placeholder: "EAAG...",
      help: "Meta Graph API page token with pages_manage_posts permission.",
      maxLen: 1024,
    },
    {
      name: "pageId",
      label: "Page ID",
      type: "text",
      required: true,
      placeholder: "1234567890",
      maxLen: 64,
    },
  ],
  "google-forms": [
    {
      name: "apiKey",
      label: "Apps Script Web App Token",
      type: "secret",
      required: true,
      placeholder: "token segment",
      help: "The query token appended to your Apps Script web app URL.",
      maxLen: 1024,
    },
  ],
};

function resolveIcon(name: string): LucideIcon {
  const icons = LucideIcons as unknown as Record<string, LucideIcon>;
  return icons[name] ?? Plug;
}

function renderIcon(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Shared integration card
// ---------------------------------------------------------------------------

function IntegrationCard({
  def,
  status,
  onUpdated,
  onRefresh,
}: {
  def: IntegrationDef;
  status: IntegrationStatus | null;
  onUpdated: (s: IntegrationStatus) => void;
  onRefresh: () => Promise<void>;
}) {
  const enabled = status?.enabled ?? false;
  const hasSecret = Boolean(status?.secretPreview);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function handleToggle(next: boolean) {
    // Optimistic flip, revert on error. For outbound_api integrations,
    // enabling requires config + secret — the route enforces this and returns
    // 400; we surface the message and revert.
    const prev = status;
    if (prev) onUpdated({ ...prev, enabled: next });
    setToggling(true);
    const { data, error } = await api.put<{ item: IntegrationStatus }>(
      `/api/integrations/${def.id}`,
      { enabled: next },
    );
    setToggling(false);
    if (error || !data) {
      if (prev) onUpdated({ ...prev, enabled: prev.enabled });
      toast.error(
        next ? "Could not enable integration" : "Could not disable integration",
        {
          description:
            error?.message ??
            "Try again or open Configure to set required fields.",
        },
      );
      return;
    }
    onUpdated(data.item);
    toast.success(next ? `${def.label} enabled` : `${def.label} disabled`);
  }

  async function handleTest() {
    setTesting(true);
    const { data, error } = await api.post<{
      ok: boolean;
      kind?: string;
      reason?: string | null;
      skipped?: boolean;
      secret?: string;
      publishUrl?: string;
      header?: string;
    }>(`/api/integrations/${def.id}/test`, {});
    setTesting(false);
    if (error || !data) {
      toast.error("Connection test failed", { description: error?.message });
      return;
    }
    if (def.kind === "webhook" && data.secret) {
      // Webhook test returns the signing key (first enable). Reveal + copy hint.
      toast.success("Webhook ready", {
        description: "Signing key generated. Copy it from the card below.",
      });
    } else if (data.ok) {
      toast.success(
        data.skipped ? "Configuration valid" : "Connection successful",
        {
          description: data.reason ?? undefined,
        },
      );
    } else {
      toast.error("Connection failed", {
        description: data.reason ?? undefined,
      });
    }
    void onRefresh();
  }

  async function handleClear() {
    const { data, error } = await api.delete<{ item: IntegrationStatus }>(
      `/api/integrations/${def.id}`,
    );
    setClearOpen(false);
    if (error || !data) {
      toast.error("Could not clear integration", {
        description: error?.message,
      });
      return;
    }
    onUpdated(data.item);
    toast.success(`${def.label} cleared`);
  }

  return (
    <Card className="group relative flex flex-col border-border/60 transition-shadow hover:shadow-md">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            {renderIcon(def.icon, "size-5")}
          </span>
          <StatusBadge
            enabled={enabled}
            hasSecret={hasSecret}
            loading={false}
          />
        </div>
        <CardTitle className="text-base">{def.label}</CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          {def.desc}
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-auto space-y-3">
        {/* Webhook: show publish URL + key reveal when enabled */}
        {def.kind === "webhook" && enabled && (
          <WebhookKeyBox status={status} onRefresh={onRefresh} />
        )}

        {/* Outbound: show masked secret + config summary when enabled */}
        {def.kind === "outbound_api" &&
          status &&
          (hasSecret || Object.keys(status.config).length > 0) && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              {hasSecret && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Secret</span>
                  <code className="font-mono text-foreground">
                    {status.secretPreview}
                  </code>
                </div>
              )}
              {Object.entries(status.config).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-muted-foreground">{k}</span>
                  <code
                    className="truncate font-mono text-foreground"
                    title={v}
                  >
                    {v}
                  </code>
                </div>
              ))}
            </div>
          )}

        {/* Enable/disable toggle row */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2">
          <Label
            htmlFor={`enable-${def.id}`}
            className="cursor-pointer text-xs font-medium"
          >
            {enabled ? "Enabled" : "Disabled"}
          </Label>
          <Switch
            id={`enable-${def.id}`}
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            disabled={toggling}
            aria-label={`Toggle ${def.label}`}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {def.kind === "outbound_api" ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setConfigOpen(true)}
              aria-label={`Configure ${def.label}`}
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              Configure
            </Button>
          ) : null}
          <Button
            variant={enabled ? "default" : "outline"}
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => void handleTest()}
            disabled={
              testing || (def.kind === "outbound_api" && !enabled && !hasSecret)
            }
            aria-label={`Test connection for ${def.label}`}
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            {def.kind === "webhook" ? "Get key" : "Test"}
          </Button>
          {(enabled || hasSecret) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setClearOpen(true)}
                  aria-label={`Clear ${def.label} configuration`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear credentials</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>

      {def.kind === "outbound_api" && (
        <ConfigDialog
          def={def}
          status={status}
          open={configOpen}
          onOpenChange={setConfigOpen}
          onSaved={(s) => {
            onUpdated(s);
            setConfigOpen(false);
          }}
        />
      )}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {def.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This disables the integration and permanently deletes its stored
              credentials. Any external systems using the old key will stop
              working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleClear()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({
  enabled,
  hasSecret,
  loading,
}: {
  enabled: boolean;
  hasSecret: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Checking
      </Badge>
    );
  }
  if (enabled) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
      >
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Enabled
      </Badge>
    );
  }
  if (hasSecret) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" />
        Disabled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Plug className="size-3" aria-hidden="true" />
      Not configured
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Webhook key box (reveal / copy / rotate)
// ---------------------------------------------------------------------------

function WebhookKeyBox({
  status,
  onRefresh,
}: {
  status: IntegrationStatus | null;
  onRefresh: () => Promise<void>;
}) {
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function handleReveal() {
    // The key is only returned by the test/rotate endpoint, never by GET.
    const { data, error } = await api.post<{ secret?: string }>(
      "/api/integrations/webhook/test",
      {},
    );
    if (error || !data?.secret) {
      toast.error("Could not retrieve signing key", {
        description: error?.message,
      });
      return;
    }
    setRevealed(data.secret);
  }

  async function handleRotate() {
    setRotating(true);
    const { data, error } = await api.post<{
      secret?: string;
      item: IntegrationStatus;
    }>("/api/integrations/webhook", {});
    setRotating(false);
    if (error || !data) {
      toast.error("Could not rotate key", { description: error?.message });
      return;
    }
    setRevealed(data.secret ?? null);
    toast.success("Signing key rotated", {
      description:
        "The previous key is invalidated. Update your external systems.",
    });
    void onRefresh();
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard unavailable", {
        description: "Copy the key manually.",
      });
    }
  }

  const publishUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhook/publish`
      : "/api/webhook/publish";

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Publish URL
        </p>
        <div className="flex items-center gap-1.5">
          <code
            className="flex-1 truncate font-mono text-[11px] text-foreground"
            title={publishUrl}
          >
            {publishUrl}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => void handleCopy(publishUrl)}
            aria-label="Copy publish URL"
          >
            <Copy className="size-3" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Signing key
        </p>
        {revealed ? (
          <div className="flex items-center gap-1.5">
            <code
              className="flex-1 truncate font-mono text-[11px] text-foreground"
              title={revealed}
            >
              {revealed}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => void handleCopy(revealed)}
              aria-label="Copy signing key"
            >
              {copied ? (
                <CheckCircle2
                  className="size-3 text-emerald-600"
                  aria-hidden="true"
                />
              ) : (
                <Copy className="size-3" aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setRevealed(null)}
              aria-label="Hide signing key"
            >
              <EyeOff className="size-3" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1.5">
            <code className="font-mono text-[11px] text-muted-foreground">
              {status?.secretPreview ?? "—"}
            </code>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => void handleReveal()}
                aria-label="Reveal signing key"
              >
                <Eye className="size-3" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => void handleRotate()}
                disabled={rotating}
                aria-label="Rotate signing key"
              >
                <RefreshCw
                  className={cn("size-3", rotating && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Sign requests with{" "}
        <code className="text-foreground">x-aoc-signature</code> +{" "}
        <code className="text-foreground">x-aoc-timestamp</code> (HMAC-SHA256 of{" "}
        <code className="text-foreground">timestamp.body</code>).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config dialog (outbound_api integrations)
// ---------------------------------------------------------------------------

function ConfigDialog({
  def,
  status,
  open,
  onOpenChange,
  onSaved,
}: {
  def: IntegrationDef;
  status: IntegrationStatus | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (s: IntegrationStatus) => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [secret, setSecret] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Hydrate from existing status when the dialog opens.
  React.useEffect(() => {
    if (open) {
      setValues(status?.config ?? {});
      setSecret("");
      setFormError(null);
    }
  }, [open, status]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    // Send config + (optional) secret. The route merges + validates.
    const payload: Record<string, unknown> = { enabled: true, config: values };
    if (secret.trim()) payload.secret = secret.trim();
    const { data, error } = await api.put<{ item: IntegrationStatus }>(
      `/api/integrations/${def.id}`,
      payload,
    );
    setSaving(false);
    if (error || !data) {
      setFormError(error?.message ?? "Failed to save.");
      return;
    }
    toast.success(`${def.label} saved`);
    onSaved(data.item);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Configure {def.label}</DialogTitle>
          <DialogDescription>
            Enter the credentials below. Secrets are stored server-side and
            never displayed again after saving.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          {def.fields.map((field) => {
            const isSecret = field.type === "secret";
            const value = isSecret ? secret : (values[field.name] ?? "");
            return (
              <div key={field.name} className="space-y-1.5">
                <Label
                  htmlFor={`cfg-${field.name}`}
                  className="text-xs font-medium"
                >
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-destructive">*</span>
                  )}
                </Label>
                <Input
                  id={`cfg-${field.name}`}
                  type={
                    isSecret
                      ? "password"
                      : field.type === "url"
                        ? "url"
                        : "text"
                  }
                  value={value}
                  onChange={(e) => {
                    if (isSecret) setSecret(e.target.value);
                    else
                      setValues((v) => ({
                        ...v,
                        [field.name]: e.target.value,
                      }));
                  }}
                  placeholder={
                    isSecret && status?.secretPreview
                      ? `Stored: ${status.secretPreview}`
                      : field.placeholder
                  }
                  maxLength={field.maxLen}
                  required={field.required && !isSecret}
                  aria-label={field.label}
                />
                {field.help && (
                  <p className="text-[11px] text-muted-foreground">
                    {field.help}
                  </p>
                )}
              </div>
            );
          })}
          {formError && (
            <p className="text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
