import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { withCache, CACHE_NO_STORE } from "@/lib/cache";

export const GET = withPrismaError(async function GET(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`analytics:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "7");

  const days = Number.isFinite(daysRaw)
    ? Math.min(90, Math.max(1, Math.floor(daysRaw)))
    : 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const [totalRows, dailyRows, topPaths, deviceRows, countryRows] =
    await Promise.all([
      // Totals: sum of views + distinct visitor hashes in the window.
      db.pageView.groupBy({
        by: ["visitorHash"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),

      db.pageView.findMany({
        where: { createdAt: { gte: since } },
        select: { visitorHash: true, createdAt: true },
        take: 10_000,
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
