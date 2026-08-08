"use client";

import * as React from "react";
import {
  Mail,
  ShieldCheck,
  Clock,
  UserCheck,
  UserX,
  Loader2,
  MoreVertical,
  Power,
  Trash2,
  Crown,
  CircleAlert,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InviteGenerator } from "@/components/admin/invite-generator";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface AdminUserEntry {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  sessionExpiresAt: string | null;
  isSelf: boolean;
  canManage: boolean;
}

interface ManageTarget {
  admin: AdminUserEntry;
  action: "activate" | "deactivate" | "delete";
}

export function AdminUsersPanel() {
  const [admins, setAdmins] = React.useState<AdminUserEntry[]>([]);
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [manageTarget, setManageTarget] = React.useState<ManageTarget | null>(
    null,
  );
  const [managePending, setManagePending] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    const { data, error } = await api.get<{
      items: AdminUserEntry[];
      viewerIsSuperAdmin: boolean;
    }>("/api/admin-users");
    if (error || !data) {
      setError(error?.message ?? "Failed to load admin users.");
      setAdmins([]);
    } else {
      setAdmins(data.items);
      setViewerIsSuperAdmin(data.viewerIsSuperAdmin);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function performManage() {
    if (!manageTarget || managePending) return;
    const { admin, action } = manageTarget;
    setManagePending(true);
    try {
      if (action === "delete") {
        const { error } = await api.delete(`/api/admin-users/${admin.id}`);
        if (error) throw new Error(error.message);
        toast.success("Account deleted", {
          description: `${admin.email} was removed.`,
        });
      } else {
        const active = action === "activate";
        const { error } = await api.patch(`/api/admin-users/${admin.id}`, {
          active,
        });
        if (error) throw new Error(error.message);
        toast.success(active ? "Account activated" : "Account deactivated", {
          description: `${admin.email} can ${active ? "now" : "no longer"} sign in.`,
        });
      }
      setManageTarget(null);
      await load();
    } catch (e) {
      toast.error("Action failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setManagePending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
        Loading admin users...
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-6 text-center text-sm text-destructive">
          {error}
          <div className="mt-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={load}
              className="h-8 px-2 text-xs"
            >
              Try again
            </Button>
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
          <p className="text-sm font-medium text-foreground">
            No admin accounts
          </p>
          <p className="text-xs text-muted-foreground">
            Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              bun run bootstrap
            </code>{" "}
            to create the first super admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isDelete = manageTarget?.action === "delete";
  const targetEmail = manageTarget?.admin.email ?? "";
  const manageDescription = manageTarget
    ? manageTarget.action === "delete"
      ? `This permanently deletes the account for ${targetEmail}. Their sessions and MFA challenges are revoked immediately. This cannot be undone.`
      : manageTarget.action === "deactivate"
        ? `${targetEmail} will be signed out immediately and cannot sign in until reactivated. Their account data is preserved.`
        : `${targetEmail} will be able to sign in again with their existing password.`
    : "";

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Admin Accounts
          </CardTitle>
          <CardDescription>
            {admins.length} {admins.length === 1 ? "account" : "accounts"} with
            access to this panel.
            {viewerIsSuperAdmin && " You can manage regular admin accounts."}
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
              const isSuperAdmin = admin.role === "super_admin";
              return (
                <li
                  key={admin.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border border-border/60 bg-card/40 p-3 transition-colors",
                    admin.isSelf
                      ? "ring-1 ring-inset ring-primary/30"
                      : "hover:bg-card/80",
                    !admin.active && "opacity-60",
                  )}
                >
                  <Avatar className="size-10 border border-border/60">
                    <AvatarFallback
                      className={cn(
                        "text-xs font-semibold",
                        isSuperAdmin
                          ? "bg-gold-500/15 text-gold-600 dark:text-gold-400"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {admin.name || admin.email}
                      </p>
                      {admin.isSelf && (
                        <Badge
                          variant="outline"
                          className="border-primary/40 text-[10px] text-primary"
                        >
                          You
                        </Badge>
                      )}
                      {isSuperAdmin && (
                        <Badge
                          variant="outline"
                          className="border-gold-400/60 text-[10px] text-gold-600 dark:text-gold-400"
                        >
                          <Crown className="mr-1 size-2.5" aria-hidden="true" />
                          Super Admin
                        </Badge>
                      )}
                      {activeNow && admin.active && (
                        <Badge
                          variant="outline"
                          className="border-emerald-300 text-[10px] text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
                        >
                          <span
                            className="mr-1 size-1.5 rounded-full bg-emerald-500"
                            aria-hidden="true"
                          />
                          Online
                        </Badge>
                      )}
                      {!admin.active && (
                        <Badge
                          variant="outline"
                          className="border-amber-400/60 text-[10px] text-amber-600 dark:text-amber-400"
                        >
                          <Power className="mr-1 size-2.5" aria-hidden="true" />
                          Inactive
                        </Badge>
                      )}
                      {!isSuperAdmin && (
                        <Badge variant="secondary" className="text-[10px]">
                          Admin
                        </Badge>
                      )}
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
                  {admin.canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0 text-muted-foreground"
                          aria-label={`Manage ${admin.email}`}
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {admin.active ? (
                          <DropdownMenuItem
                            onClick={() =>
                              setManageTarget({ admin, action: "deactivate" })
                            }
                            className="text-amber-600 focus:text-amber-700 dark:text-amber-400"
                          >
                            <Power className="mr-2 size-4" aria-hidden="true" />
                            Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              setManageTarget({ admin, action: "activate" })
                            }
                            className="text-emerald-600 focus:text-emerald-700 dark:text-emerald-400"
                          >
                            <Power className="mr-2 size-4" aria-hidden="true" />
                            Activate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            setManageTarget({ admin, action: "delete" })
                          }
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 size-4" aria-hidden="true" />
                          Delete account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
          {viewerIsSuperAdmin && (
            <Alert className="mt-4">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="text-xs">
                Super admin accounts cannot be deactivated or deleted. You
                cannot manage your own account. Deleted accounts are removed
                permanently along with their sessions.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      {viewerIsSuperAdmin && <InviteGenerator />}
      <ConfirmDialog
        open={manageTarget !== null}
        onOpenChange={(o) => {
          if (!o && !managePending) setManageTarget(null);
        }}
        mode={isDelete ? "destructive" : "soft"}
        title={
          manageTarget?.action === "delete"
            ? "Delete admin account"
            : manageTarget?.action === "deactivate"
              ? "Deactivate admin account"
              : "Activate admin account"
        }
        description={manageDescription}
        confirmLabel={
          manageTarget?.action === "delete"
            ? "Delete account"
            : manageTarget?.action === "deactivate"
              ? "Deactivate"
              : "Activate"
        }
        confirmToken={isDelete ? targetEmail : "DELETE"}
        confirmTokenHint={isDelete ? "the admin's email address" : undefined}
        onConfirm={performManage}
      />
    </div>
  );
}

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
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
