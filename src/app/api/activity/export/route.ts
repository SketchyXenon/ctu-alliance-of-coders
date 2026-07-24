import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildCsv } from "@/lib/csv";

/**
 * GET /api/activity/export - admin only, returns CSV.
 * Uses buildCsv so every cell is run through csvEscape (defense-in-depth
 * against formula injection, per 06 A05). No cell is interpolated raw.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs = await db.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const csv = buildCsv(
    ["timestamp", "action", "entity", "entity_id", "summary"],
    logs.map((l) => [
      l.createdAt.toISOString(),
      l.action,
      l.entity,
      l.entityId ?? "",
      l.summary,
    ])
  );

  const res = new NextResponse(csv);
  res.headers.set("Content-Type", "text/csv; charset=utf-8");
  res.headers.set(
    "Content-Disposition",
    `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
