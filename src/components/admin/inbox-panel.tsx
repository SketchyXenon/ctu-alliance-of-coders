"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Eye,
  Inbox as InboxIcon,
  Mail,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/security";
import { cn } from "@/lib/utils";
import type { ContactMessage, ContactStatus } from "@/lib/types";

interface InboxPanelProps {
  messages: ContactMessage[];
  onRefresh: () => void;
}

const STATUS_FILTERS: { value: ContactStatus | "all"; label: string }[] = [
  { value: "all", label: "All messages" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

function statusBadge(status: ContactStatus) {
  const map: Record<
    ContactStatus,
    { label: string; className: string }
  > = {
    new: {
      label: "New",
      className:
        "bg-gold-100 text-gold-800 border-gold-300 dark:bg-gold-500/20 dark:text-gold-300 dark:border-gold-500/40",
    },
    read: {
      label: "Read",
      className:
        "bg-secondary text-secondary-foreground border-border dark:bg-secondary/60",
    },
    resolved: {
      label: "Resolved",
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    },
    archived: {
      label: "Archived",
      className:
        "bg-muted text-muted-foreground border-border dark:bg-muted/40",
    },
  };
  const cfg = map[status];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "new" | "read" | "resolved";
}) {
  const tones = {
    new: "text-gold-600 dark:text-gold-300",
    read: "text-foreground",
    resolved: "text-emerald-600 dark:text-emerald-300",
  } as const;
  return (
    <Card className="border-border/60 bg-card/60 py-3">
      <CardContent className="px-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className={`font-display text-2xl font-bold ${tones[tone]}`}>
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageCard({
  message,
  onStatusChange,
  onDelete,
  busyId,
}: {
  message: ContactMessage;
  onStatusChange: (id: string, status: ContactStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busyId: string | null;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const busy = busyId === message.id;
  const preview = expanded
    ? message.message
    : message.message.length > 200
      ? message.message.slice(0, 200) + "..."
      : message.message;

  return (
    <Card className="border-border/60 transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="text-base font-semibold leading-snug">
              {message.subject}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.name}
              </span>
              <span aria-hidden="true">&middot;</span>
              <a
                href={`mailto:${message.email}`}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
              >
                <Mail className="size-3" aria-hidden="true" />
                {message.email}
              </a>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-border/70">
              {message.category}
            </Badge>
            {statusBadge(message.status)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {formatDateTime(message.createdAt)}
        </p>
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground/90">
          {preview}
        </p>
        {message.message.length > 200 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <Eye className="size-3.5" aria-hidden="true" />
            {expanded ? "Show less" : "Show full message"}
          </Button>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {message.status !== "read" && message.status !== "resolved" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onStatusChange(message.id, "read")}
            >
              <Eye className="size-3.5" aria-hidden="true" />
              Mark Read
            </Button>
          )}
          {message.status !== "resolved" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onStatusChange(message.id, "resolved")}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            >
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Mark Resolved
            </Button>
          )}
          {message.status !== "archived" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onStatusChange(message.id, "archived")}
            >
              <Archive className="size-3.5" aria-hidden="true" />
              Archive
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onStatusChange(message.id, "new")}
            >
              <ArchiveRestore className="size-3.5" aria-hidden="true" />
              Restore
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onDelete(message.id)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete message"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </Button>
            </TooltipTrigger>
            <TooltipContent>Permanently remove this message</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

export function InboxPanel({ messages, onRefresh }: InboxPanelProps) {
  const [filter, setFilter] = React.useState<ContactStatus | "all">("all");
  const [search, setSearch] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const counts = React.useMemo(
    () => ({
      new: messages.filter((m) => m.status === "new").length,
      read: messages.filter((m) => m.status === "read").length,
      resolved: messages.filter((m) => m.status === "resolved").length,
    }),
    [messages]
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (filter !== "all" && m.status !== filter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.message.toLowerCase().includes(q)
      );
    });
  }, [messages, filter, search]);

  async function handleStatusChange(id: string, status: ContactStatus) {
    setBusyId(id);
    const { data, error } = await api.patch<{ item: ContactMessage }>(
      `/api/contact/${id}`,
      { status }
    );
    setBusyId(null);
    if (error || !data) {
      toast.error("Update failed", {
        description: error?.message ?? "Please try again.",
      });
      return;
    }
    onRefresh();
    toast.success("Message updated", {
      description: `Status set to "${status}".`,
    });
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const { error } = await api.delete(`/api/contact/${id}`);
    setBusyId(null);
    if (error) {
      toast.error("Delete failed", {
        description: error.message,
      });
      return;
    }
    onRefresh();
    toast.success("Message deleted");
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="New" value={counts.new} tone="new" />
        <StatCard label="Read" value={counts.read} tone="read" />
        <StatCard label="Resolved" value={counts.resolved} tone="resolved" />
      </div>

      <Card className="border-border/60">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <InboxIcon className="size-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Inbox</CardTitle>
              <Badge variant="secondary" className="ml-1">
                {filtered.length}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search messages..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full sm:w-56"
                aria-label="Search messages"
              />
              <Select
                value={filter}
                onValueChange={(v) =>
                  setFilter(v as ContactStatus | "all")
                }
              >
                <SelectTrigger className="h-9 w-44" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Refresh inbox"
              >
                <RefreshCw
                  className={refreshing ? "size-4 animate-spin" : "size-4"}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <div className="relative">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-700 to-navy-900 text-gold-400 shadow-sm">
                  <InboxIcon className="size-8" aria-hidden="true" />
                </div>
                <div
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-gold-500 text-[10px] font-bold text-navy-950 shadow"
                >
                  0
                </div>
              </div>
              <div className="space-y-1">
                <p className="font-display text-base font-semibold text-foreground">
                  {messages.length === 0 ? "Inbox is empty" : "No matching messages"}
                </p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {messages.length === 0
                    ? "New contact form submissions from the public site will appear here automatically."
                    : "Try adjusting your search or status filter to find what you're looking for."}
                </p>
              </div>
              {messages.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="mt-1"
                >
                  <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
                  Refresh
                </Button>
              )}
            </div>
          ) : (
            <div className="max-h-[600px] space-y-3 overflow-y-auto scrollbar-thin p-4">
              {filtered.map((m) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  busyId={busyId}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
