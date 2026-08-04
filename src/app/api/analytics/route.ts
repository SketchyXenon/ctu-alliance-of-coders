import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withPrismaError } from "@/lib/route-helpers";
import { withCache, CACHE_NO_STORE } from "@/lib/cache";

/**
 * GET /api/analytics - admin-only aggregate page-view stats.
 *
 * Query params:
 *   ?days=7   - lookback window in days (default 7, max 90).
 *
 * Returns:
 *   - totals: total views + unique visitors in the window.
 *   - daily: [{ date, views, visitors }] for a sparkline.
 *   - topPaths: [{ path, views, visitors }] top 10.
 *   - byDevice: [{ device, views }] coarse device breakdown.
 *   - byCountry: [{ country, views }] top 10 countries.
 *
 */
export const GET = withPrismaError(async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "7");
  // Clamp: 1..90. NaN -> default. Per 06 section 5: validate external input.
  const days = Number.isFinite(daysRaw)
    ? Math.min(90, Math.max(1, Math.floor(daysRaw)))
    : 7;
  const since = new Date(Date.now() - days * 86_400_000);

  // Run all aggregates in parallel so the latency is the max, not the sum.
  // Per 02 section 6: bounded queries (LIMIT, indexed createdAt).
  const [totalRows, dailyRows, topPaths, deviceRows, countryRows] =
    await Promise.all([
      // Totals: sum of views + distinct visitor hashes in the window.
      db.pageView.groupBy({
        by: ["visitorHash"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Daily breakdown for the sparkline. SQLite/Postgres both support
      // date trunc via substring of the ISO timestamp (UTC day).
      // Bounded take (06 section 7: resource limits) so a 90-day window on a
      // busy site can't OOM the function. The sparkline is approximate if the
      // cap is hit; totals use the groupBy above which is already bounded.
      db.pageView.findMany({
        where: { createdAt: { gte: since } },
        select: { visitorHash: true, createdAt: true },
        take: 100_000,
      }),
      db.pageView.groupBy({
        by: ["path"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      db.pageView.groupBy({
        by: ["device"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      db.pageView.groupBy({
        by: ["country"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
    ]);

  const totalViews = totalRows.reduce((s, r) => s + r._count._all, 0);
  const uniqueVisitors = new Set(
    totalRows.map((r) => r.visitorHash).filter((h): h is string => Boolean(h)),
  ).size;

  // Build the daily sparkline from the raw rows (cheaper than N groupBy calls
  // and works identically on SQLite + Postgres).
  const dailyMap = new Map<string, { views: number; visitors: Set<string> }>();
  for (const row of dailyRows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    const entry = dailyMap.get(day) ?? {
      views: 0,
      visitors: new Set<string>(),
    };
    entry.views += 1;
    if (row.visitorHash) entry.visitors.add(row.visitorHash);
    dailyMap.set(day, entry);
  }
  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, views: v.views, visitors: v.visitors.size }));

  return withCache(
    NextResponse.json({
      days,
      since: since.toISOString(),
      totals: { views: totalViews, visitors: uniqueVisitors },
      daily,
      topPaths: topPaths.map((r) => ({ path: r.path, views: r._count._all })),
      byDevice: deviceRows.map((r) => ({
        device: r.device ?? "unknown",
        views: r._count._all,
      })),
      byCountry: countryRows.map((r) => ({
        country: r.country ?? "unknown",
        views: r._count._all,
      })),
    }),
    CACHE_NO_STORE,
  );
});
