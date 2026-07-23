import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const PAGE_SIZE = 50;

/**
 * GET /api/activity - admin only, returns paginated activity logs.
 * Query params: ?cursor=<id> for pagination (cursor-based).
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");

  const logs = await db.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

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
    nextCursor: hasMore ? items[items.length - 1].id : null,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
