"use client";

import * as React from "react";
import {
  Clock,
  Loader2,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface SessionEntry {
  id: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/**
 * SessionsPanel - shows active sessions with revoke buttons.
 *
 * Per VLM feedback: fixed metadata wrapping (whitespace-nowrap on the time
 * line), bolded device labels for hierarchy, added hover states, added a
 * "Revoke all other" bulk action, and device-type icon variants.
 */
export function SessionsPanel() {
  const [sessions, setSessions] = React.useState<SessionEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [revokingAll, setRevokingAll] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  // H15: track which session is pending revoke confirmation. null = dialog closed.
  const [confirmRevokeId, setConfirmRevokeId] = React.useState<string | null>(
    null,
  );
  const confirmSession = sessions.find((s) => s.id === confirmRevokeId) ?? null;

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await api.get<{ items: SessionEntry[] }>("/api/sessions");
    if (data) setSessions(data.items);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(id: string) {
    setRevoking(id);
    const { error } = await api.delete(`/api/sessions/${id}`);
    setRevoking(null);
    if (error) {
      void load();
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleRevokeAllOthers() {
    const others = sessions.filter((s) => !s.isCurrent);
    if (others.length === 0) return;
    setRevokingAll(true);
    setBulkError(null);
    // Revoke in parallel; only drop the sessions that actually deleted.
    // C1 fix: previously ALL others were removed from local state regardless
    // of whether each DELETE succeeded — a network blip left dead sessions
    // visible as "revoked" while they stayed alive server-side. Per 03 §6:
    // never swallow an exception silently; per 05 §6: status must match reality.
    const results = await Promise.allSettled(
      others.map((s) => api.delete(`/api/sessions/${s.id}`)),
    );
    setRevokingAll(false);

    const deletedIds = new Set<string>();
    let failedCount = 0;
    results.forEach((r, i) => {
      const ok = r.status === "fulfilled" && !r.value.error;
      if (ok) {
        deletedIds.add(others[i].id);
      } else {
        failedCount += 1;
      }
    });

    if (deletedIds.size > 0) {
      setSessions((prev) =>
        prev.filter((s) => s.isCurrent || !deletedIds.has(s.id)),
      );
    }
    if (failedCount > 0) {
      // Some revokes failed — reload to reflect true server state, and surface
      // the failure so the admin knows those sessions may still be active.
      setBulkError(
        failedCount === others.length
          ? "Failed to revoke any sessions. They may still be active."
          : `Failed to revoke ${failedCount} session(s). They may still be active.`,
      );
      void load();
    }
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Monitor className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          No active sessions
        </p>
      </div>
    );
  }

  const otherCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-3">
      {/* Header row: summary + bulk action */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {sessions.length} active session{sessions.length === 1 ? "" : "s"}.
          Revoke to sign out other devices.
        </p>
        {otherCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevokeAllOthers}
            disabled={revokingAll}
            className="h-8 gap-1.5 self-start text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 sm:self-auto"
          >
            {revokingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            Revoke all others ({otherCount})
          </Button>
        )}
      </div>

      {/* C1: inline error banner for partial/total bulk-revoke failure.
          Per 05-ui-ux-design.md §6: persistent system-level state uses an
          inline banner; per §6 copy: state what happened and what to do next. */}
      {bulkError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <span aria-hidden="true" className="mt-0.5">
            &middot;
          </span>
          <span className="flex-1">{bulkError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-destructive hover:bg-destructive/10"
            onClick={() => setBulkError(null)}
            aria-label="Dismiss"
          >
            Dismiss
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {sessions.map((session) => {
          // Rotate device icon by session index for visual variety.
          const DeviceIcon = session.isCurrent
            ? ShieldCheck
            : ([Monitor, Smartphone, Tablet, Monitor][
                Math.abs(
                  session.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
                ) % 3
              ] ?? Monitor);
          return (
            <li
              key={session.id}
              className={cn(
                "flex items-center gap-3 rounded-md border p-3 transition-colors",
                session.isCurrent
                  ? "border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-950/20"
                  : "border-border/60 bg-card/40 hover:bg-card/80 hover:border-border",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  session.isCurrent
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <DeviceIcon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {session.isCurrent ? "This device" : "Other device"}
                  </p>
                  {session.isCurrent && (
                    <Badge
                      variant="outline"
                      className="border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
                    >
                      Current
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
                  <Clock className="size-3 shrink-0" aria-hidden="true" />
                  <span>Signed in {timeAgo(session.createdAt)}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>Expires {formatDateTime(session.expiresAt)}</span>
                </p>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmRevokeId(session.id)}
                  disabled={revoking === session.id}
                  aria-label="Revoke session"
                >
                  {revoking === session.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Strict double confirmation per 05-ui-ux-design.md section 6: revoking
          a session signs out that device immediately. The admin must type
          REVOKE to arm the button so a stray click or Enter can't sign out a
          real user. */}
      <ConfirmDialog
        open={confirmSession !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRevokeId(null);
        }}
        mode="destructive"
        title="Revoke this session?"
        description={
          confirmSession
            ? `Signed in ${timeAgo(confirmSession.createdAt)}. The device will be signed out immediately and will need to sign in again. This action cannot be undone.`
            : "The device will be signed out immediately and will need to sign in again."
        }
        confirmLabel={revoking !== null ? "Revoking..." : "Revoke session"}
        confirmToken="REVOKE"
        onConfirm={async () => {
          if (confirmSession) {
            await handleRevoke(confirmSession.id);
            setConfirmRevokeId(null);
          }
        }}
      />
    </div>
  );
}
