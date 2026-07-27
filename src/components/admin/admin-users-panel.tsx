"use client";

import * as React from "react";
import { Mail, ShieldCheck, Clock, UserCheck, UserX, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface AdminUserEntry {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  lastActiveAt: string | null;
  sessionExpiresAt: string | null;
  isSelf: boolean;
}

/**
 * AdminUsersPanel - lists all admin accounts with role + last-active.
 *
 * Per the feature request: "integrate an interface for all admin users
 * display for all admin accounts." Shows each admin's email, name, role,
 * when they were created, and when they were last active (from their most
 * recent session). The current viewer is badged "You".
 *
 * Per 06 section 3: the data is admin-only (the route requires requireAdmin).
 * Per 05 section 6: empty state says what belongs + how to add (bootstrap
 * script is the only way to create the first admin — noted in the copy).
 */
export function AdminUsersPanel() {
  const [admins, setAdmins] = React.useState<AdminUserEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await api.get<{ items: AdminUserEntry[] }>("/api/admin-users");
    if (error || !data) {
      setError(error?.message ?? "Failed to load admin users.");
      setAdmins([]);
    } else {
      setAdmins(data.items);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
        Loading admin users…
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-6 text-center text-sm text-destructive">
          {error}
          <div className="mt-3">
            <button
              type="button"
              onClick={load}
              className="text-xs font-medium underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (admins.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">No admin accounts</p>
          <p className="text-xs text-muted-foreground">
            Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">bun run bootstrap</code> to
            create the first admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-lg">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          Admin Accounts
        </CardTitle>
        <CardDescription>
          {admins.length} admin {admins.length === 1 ? "account" : "accounts"} with access to this panel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {admins.map((admin) => {
            const initials = (admin.email || "?")
              .split("@")[0]
              .slice(0, 2)
              .toUpperCase();
            const activeNow = admin.sessionExpiresAt
              ? new Date(admin.sessionExpiresAt) > new Date()
              : false;
            return (
              <li
                key={admin.id}
                className={cn(
                  "flex items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3 transition-colors",
                  admin.isSelf ? "ring-1 ring-inset ring-primary/30" : "hover:bg-card/80"
                )}
              >
                <Avatar className="size-10 border border-border/60">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {admin.name || admin.email}
                    </p>
                    {admin.isSelf && (
                      <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                        You
                      </Badge>
                    )}
                    {activeNow && (
                      <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
                        <span className="mr-1 size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        Active
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {admin.role}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3" aria-hidden="true" />
                      <span className="truncate">{admin.email}</span>
                    </span>
                    {admin.lastActiveAt && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" aria-hidden="true" />
                        Last active {formatRelative(admin.lastActiveAt)}
                      </span>
                    )}
                    {!admin.lastActiveAt && (
                      <span className="inline-flex items-center gap-1">
                        <UserX className="size-3" aria-hidden="true" />
                        Never signed in
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <UserCheck className="size-3" aria-hidden="true" />
                      Added {formatRelative(admin.createdAt)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Format an ISO timestamp as a relative "2h ago" / "3d ago" string. */
function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
