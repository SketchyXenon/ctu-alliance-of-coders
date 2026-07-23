"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  Download,
  Edit3,
  LogIn,
  LogOut,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ActivityEntry {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

const ACTION_ICON: Record<string, LucideIcon> = {
  create: Plus,
  update: Edit3,
  delete: Trash2,
  login: LogIn,
  logout: LogOut,
};

const ACTION_COLOR: Record<string, string> = {
  create: "text-emerald-600 dark:text-emerald-400",
  update: "text-blue-600 dark:text-blue-400",
  delete: "text-red-600 dark:text-red-400",
  login: "text-gold-600 dark:text-gold-400",
  logout: "text-muted-foreground",
};

const ENTITY_LABELS: Record<string, string> = {
  announcement: "Announcements",
  officer: "Officers",
  year: "Years",
  message: "Messages",
  session: "Sessions",
};

type FilterValue = "all" | "create" | "update" | "delete" | "login";

/**
 * ActivityPanel - shows recent admin actions with search + filter.
 */
export function ActivityPanel() {
  const [entries, setEntries] = React.useState<ActivityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState<FilterValue>("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await api.get<{ items: ActivityEntry[]; nextCursor: string | null }>("/api/activity");
    if (data) {
      setEntries(data.items);
      setNextCursor(data.nextCursor);
    }
    setLoading(false);
  }, []);

  const loadMore = React.useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const { data } = await api.get<{ items: ActivityEntry[]; nextCursor: string | null }>(
      `/api/activity?cursor=${encodeURIComponent(nextCursor)}`
    );
    if (data) {
      setEntries((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    }
    setLoadingMore(false);
  }, [nextCursor, loadingMore]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    let result = entries;
    if (actionFilter !== "all") {
      result = result.filter((e) => e.action === actionFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (e) =>
          e.summary.toLowerCase().includes(q) ||
          e.entity.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q)
      );
    }
    return result;
  }, [entries, actionFilter, search]);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search activity log"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select
          value={actionFilter}
          onValueChange={(v) => setActionFilter(v as FilterValue)}
        >
          <SelectTrigger className="w-full sm:w-[160px]" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="create">Creates</SelectItem>
            <SelectItem value="update">Updates</SelectItem>
            <SelectItem value="delete">Deletes</SelectItem>
            <SelectItem value="login">Logins</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <Activity className={cn("size-4", loading && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("/api/activity/export", "_blank")}
        >
          <Download className="size-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
      </p>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading activity...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Activity className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {entries.length === 0 ? "No activity yet" : "No matching entries"}
          </p>
          <p className="text-xs text-muted-foreground">
            {entries.length === 0
              ? "Admin actions will appear here."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <ol className="max-h-[500px] space-y-1.5 overflow-y-auto scrollbar-thin pr-1">
          {filtered.map((entry) => {
            const Icon = ACTION_ICON[entry.action] ?? CheckCircle2;
            const color = ACTION_COLOR[entry.action] ?? "text-muted-foreground";
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border border-border/60 bg-card/40 p-3 transition",
                  "hover:border-border hover:bg-card/80 hover:shadow-sm"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted",
                    color
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug text-foreground">
                    {entry.summary}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {entry.action}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </Badge>
                    <span className="ml-auto text-xs font-medium text-muted-foreground">
                      {formatTime(entry.createdAt)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Load more */}
      {nextCursor && !loading && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Activity className="size-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
