import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withPrismaError } from "@/lib/route-helpers";

const PAGE_SIZE = 20;

/**
 * GET /api/activity - admin only, returns paginated activity logs.
 * Query params: ?cursor=<id> for pagination (cursor-based).
 *
 * Per 04-testing-methodology.md + 02-system-design.md section 6: cursor-based
 * pagination scales (no OFFSET degradation) and bounds memory. PAGE_SIZE=20 so
 * a single load is cheap; the client "Load more"s on demand. Also returns the
 * total count so the UI can show "Showing X of Y entries".
 * Wrapped with withPrismaError so DB-down returns a clean 503 (03 section 6).
 */
export const GET = withPrismaError(async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");

  // Run the page query + the total count in parallel so the latency is the
  // max of the two, not the sum. Per 02 section 6: no unbounded waits — both
  // queries are bounded (PAGE_SIZE+1 take, count is a single aggregate).
  const [logs, total] = await Promise.all([
    db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    }),
    db.activityLog.count(),
  ]);

  const hasMore = logs.length > PAGE_SIZE;
  const items = (hasMore ? logs.slice(0, PAGE_SIZE) : logs).map((l) => ({
    id: l.id,
    userId: l.userId,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    summary: l.summary,
    createdAt: l.createdAt.toISOString(),
  }));

  const res = NextResponse.json({
    items,
    total,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
