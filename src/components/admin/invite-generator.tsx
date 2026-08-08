"use client";

import * as React from "react";
import {
  Clock,
  Copy,
  Link2,
  Loader2,
  Mail,
  MailCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api-client";
import { validateEmail } from "@/lib/security";
import { cn } from "@/lib/utils";

interface InviteItem {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdByEmail: string | null;
}

interface CreatedInvite {
  token: string;
  invite: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
  };
}

export function InviteGenerator() {
  const [email, setEmail] = React.useState("");
  const [ttlDays, setTtlDays] = React.useState(7);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedInvite | null>(null);

  const [invites, setInvites] = React.useState<InviteItem[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  const loadInvites = React.useCallback(async () => {
    const { data, error } = await api.get<{ items: InviteItem[] }>(
      "/api/admin-invites",
    );
    if (error || !data) {
      setInvites([]);
    } else {
      setInvites(data.items);
    }
    setLoadingList(false);
  }, []);

  React.useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  function buildInviteLink(token: string): string {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/?invite=${token}`;
    }
    return `/?invite=${token}`;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setCreated(null);

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      setError(emailCheck.error ?? "Enter a valid email.");
      return;
    }
    const ttl = Math.max(1, Math.min(Math.floor(ttlDays) || 7, 30));

    setSubmitting(true);
    const { data, error: apiError } = await api.post<CreatedInvite>(
      "/api/admin-invites",
      { email, ttlDays: ttl },
    );
    setSubmitting(false);

    if (apiError || !data) {
      setError(apiError?.message ?? "Failed to create invite.");
      return;
    }
    setCreated(data);
    setEmail("");
    setTtlDays(7);
    toast.success("Invite link generated", {
      description: "Copy it now — it won't be shown again.",
    });
    void loadInvites();
  }

  async function handleCopy(token: string) {
    const link = buildInviteLink(token);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied", {
        description: "The invite link is on your clipboard.",
      });
    } catch {
      toast.error("Could not copy", { description: link });
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    const { error } = await api.delete(`/api/admin-invites/${id}`);
    setRevokingId(null);
    if (error) {
      toast.error("Revoke failed", { description: error.message });
      return;
    }
    toast.success("Invite revoked");
    void loadInvites();
  }

  const pending = invites.filter(
    (i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date(),
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <UserPlus className="size-5 text-primary" aria-hidden="true" />
            Generate Admin Invite
          </CardTitle>
          <CardDescription>
            Create a single-use invite link for a new administrator. The link
            carries a one-time token — copy it now; it is never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} className="space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <div className="space-y-2">
                <Label
                  htmlFor="invite-email"
                  className="text-xs uppercase tracking-wider"
                >
                  <Mail className="size-3.5" aria-hidden="true" />
                  Invitee email
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="new-admin@example.com"
                  disabled={submitting}
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="invite-ttl"
                  className="text-xs uppercase tracking-wider"
                >
                  <Clock className="size-3.5" aria-hidden="true" />
                  Expires (days)
                </Label>
                <Input
                  id="invite-ttl"
                  type="number"
                  min={1}
                  max={30}
                  value={ttlDays}
                  onChange={(e) => setTtlDays(Number(e.target.value))}
                  disabled={submitting}
                />
              </div>
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Generating...
                </>
              ) : (
                <>
                  <Link2 className="size-4" aria-hidden="true" />
                  Generate invite link
                </>
              )}
            </Button>
          </form>

          {created && (
            <Alert className="border-primary/30">
              <MailCheck aria-hidden="true" />
              <AlertTitle>Invite link ready</AlertTitle>
              <AlertDescription className="space-y-3">
                <p className="text-xs">
                  For{" "}
                  <span className="font-medium">{created.invite.email}</span> ·
                  expires{" "}
                  {new Date(created.invite.expiresAt).toLocaleString("en-PH", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-[11px]">
                    {buildInviteLink(created.token)}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleCopy(created.token)}
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                    Copy
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Deliver this link to the invitee out-of-band. Anyone with the
                  link can set a password and create the admin account (single
                  use).
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Clock className="size-4 text-primary" aria-hidden="true" />
            Pending &amp; recent invites
          </CardTitle>
          <CardDescription>
            {pending.length} active invite{pending.length === 1 ? "" : "s"}.
            Revoke links that should no longer be used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="flex items-center py-6 text-sm text-muted-foreground">
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
              Loading invites...
            </div>
          ) : invites.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No invites yet. Generate one above to onboard a new administrator.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {invites.map((inv) => {
                const expired = new Date(inv.expiresAt) < new Date();
                const used = !!inv.usedAt;
                const revoked = !!inv.revokedAt;
                const active = !used && !revoked && !expired;
                return (
                  <li
                    key={inv.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3",
                      active && "hover:bg-card/80",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {inv.email}
                        </p>
                        {active && (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 text-[10px] text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
                          >
                            Active
                          </Badge>
                        )}
                        {used && (
                          <Badge variant="secondary" className="text-[10px]">
                            Used
                          </Badge>
                        )}
                        {revoked && (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-[10px] text-destructive"
                          >
                            Revoked
                          </Badge>
                        )}
                        {expired && !used && !revoked && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            Expired
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Expires{" "}
                        {new Date(inv.expiresAt).toLocaleString("en-PH", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {inv.createdByEmail
                          ? ` · by ${inv.createdByEmail}`
                          : ""}
                      </p>
                    </div>
                    {active && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevoke(inv.id)}
                        disabled={revokingId === inv.id}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Revoke invite for ${inv.email}`}
                      >
                        {revokingId === inv.id ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        )}
                        <span className="hidden sm:inline">Revoke</span>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
