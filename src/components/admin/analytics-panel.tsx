"use client";

import * as React from "react";
import {
  BarChart3,
  Eye,
  Globe,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * AnalyticsPanel - admin view of aggregate page-view stats.
 *
 * Reads GET /api/analytics (admin-gated). Shows totals, a daily sparkline,
 * top paths, and device/country breakdowns. Per 05-ui-ux-design.md: flat
 * surfaces, one accent color (gold), consistent spacing. Per 06 section 8:
 * all data shown is already privacy-minimized server-side (daily hashes, no
 * raw IP) so this view is safe to display to an authenticated admin.
 */

interface AnalyticsData {
  days: number;
  since: string;
  totals: { views: number; visitors: number };
  daily: { date: string; views: number; visitors: number }[];
  topPaths: { path: string; views: number }[];
  byDevice: { device: string; views: number }[];
  byCountry: { country: string; views: number }[];
}

const DEVICE_ICON: Record<string, React.ElementType> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  bot: Eye,
  other: Monitor,
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function AnalyticsPanel() {
  const [data, setData] = React.useState<AnalyticsData | null>(null);
  const [days, setDays] = React.useState(7);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (d: number) => {
    setLoading(true);
    const { data: payload } = await api.get<AnalyticsData>(
      `/api/analytics?days=${d}`,
    );
    if (payload) setData(payload);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load(days);
  }, [load, days]);

  // Sparkline: downsample to at most 14 bars so the chart stays readable on a
  // 375px viewport. 90 flex-1 bars + gaps compute to ~0px each and overflow.
  // Buckets consecutive days, summing views + visitors; labels the bucket
  // with its first date.
  const sparkData = React.useMemo(() => {
    const daily = data?.daily ?? [];
    if (daily.length <= 14) return daily;
    const bucketSize = Math.ceil(daily.length / 14);
    const buckets: { date: string; views: number; visitors: number }[] = [];
    for (let i = 0; i < daily.length; i += bucketSize) {
      const slice = daily.slice(i, i + bucketSize);
      buckets.push({
        date: slice[0].date,
        views: slice.reduce((s, d) => s + d.views, 0),
        visitors: slice.reduce((s, d) => s + d.visitors, 0),
      });
    }
    return buckets;
  }, [data]);

  const maxDaily = React.useMemo(
    () => Math.max(1, ...(sparkData.map((d) => d.views) ?? [1])),
    [sparkData],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BarChart3
            className="size-4 text-gold-600 dark:text-gold-400"
            aria-hidden="true"
          />
          <h3 className="font-display text-sm font-semibold text-foreground">
            Page Analytics
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-8 w-[120px]" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load(days)}
            disabled={loading}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            <span className="sr-only">Refresh analytics</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading analytics...
        </div>
      ) : !data || data.totals.views === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <BarChart3
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            No page views yet
          </p>
          <p className="text-xs text-muted-foreground">
            Anonymous visits will appear here once the site gets traffic.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Totals cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={Eye}
              label="Page Views"
              value={formatNum(data.totals.views)}
              accent="navy"
            />
            <StatCard
              icon={Users}
              label="Unique Visitors"
              value={formatNum(data.totals.visitors)}
              accent="gold"
            />
            <StatCard
              icon={BarChart3}
              label="Avg / Day"
              value={formatNum(
                Math.round(data.totals.views / Math.max(1, data.days)),
              )}
              accent="navy"
            />
            <StatCard
              icon={Globe}
              label="Countries"
              value={formatNum(
                data.byCountry.filter((c) => c.country !== "unknown").length,
              )}
              accent="gold"
            />
          </div>

          {/* Sparkline */}
          {sparkData.length > 1 && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Daily Views
              </h4>
              <div
                className="flex h-24 items-end gap-1"
                role="img"
                aria-label="Daily page views sparkline"
              >
                {sparkData.map((d) => (
                  <div
                    key={d.date}
                    className="group relative flex-1 rounded-t bg-gradient-to-t from-navy-600 to-navy-400 transition-all hover:from-gold-500 hover:to-gold-400 dark:from-navy-400 dark:to-navy-300"
                    style={{
                      height: `${Math.max(4, (d.views / maxDaily) * 100)}%`,
                    }}
                    title={`${d.date}: ${d.views} views`}
                  >
                    <span className="sr-only">
                      {d.date}: {d.views} views, {d.visitors} visitors
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{sparkData[0]?.date}</span>
                <span>{sparkData[sparkData.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Top paths + device/country */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Top Pages
              </h4>
              <ol className="space-y-1.5">
                {data.topPaths.map((p, i) => (
                  <li
                    key={p.path + i}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span
                      className="truncate font-mono text-xs text-foreground"
                      title={p.path}
                    >
                      {p.path}
                    </span>
                    <Badge
                      variant="secondary"
                      className="ml-auto shrink-0 text-[10px]"
                    >
                      {formatNum(p.views)}
                    </Badge>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By Device
                </h4>
                <div className="flex flex-wrap gap-2">
                  {data.byDevice.map((d) => {
                    const Icon = DEVICE_ICON[d.device] ?? Monitor;
                    return (
                      <span
                        key={d.device}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs"
                        title={`${d.device}: ${d.views} views`}
                      >
                        <Icon
                          className="size-3 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="capitalize text-foreground">
                          {d.device}
                        </span>
                        <span className="font-semibold text-muted-foreground">
                          {formatNum(d.views)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Top Countries
                </h4>
                <div className="flex flex-wrap gap-2">
                  {data.byCountry.filter((c) => c.country !== "unknown")
                    .length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No country data (edge headers not present in this
                      environment).
                    </p>
                  ) : (
                    data.byCountry
                      .filter((c) => c.country !== "unknown")
                      .map((c) => (
                        <span
                          key={c.country}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs"
                        >
                          <span className="font-semibold text-foreground">
                            {c.country}
                          </span>
                          <span className="text-muted-foreground">
                            {formatNum(c.views)}
                          </span>
                        </span>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Privacy: visitors are counted via a daily rotating hash — no raw IPs
            or cookies are stored. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              src/lib/analytics.ts
            </code>
            .
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: "navy" | "gold";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon
          className={cn(
            "size-3.5",
            accent === "gold"
              ? "text-gold-600 dark:text-gold-400"
              : "text-navy-600 dark:text-navy-300",
          )}
          aria-hidden="true"
        />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-1.5 font-display text-xl font-bold text-foreground">
        {value}
      </p>
    </div>
  );
}

export default AnalyticsPanel;
