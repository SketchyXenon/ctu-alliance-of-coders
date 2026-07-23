import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

/**
 * GET /api/activity/export - admin only, returns CSV.
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

  const header = "timestamp,action,entity,entity_id,summary\n";
  const body = logs
    .map((l) => {
      const ts = l.createdAt.toISOString();
      const summary = csvEscape(l.summary);
      const entityId = l.entityId ?? "";
      return `${ts},${l.action},${l.entity},${entityId},${summary}`;
    })
    .join("\n");

  const csv = header + body;
  const res = new NextResponse(csv);
  res.headers.set("Content-Type", "text/csv; charset=utf-8");
  res.headers.set(
    "Content-Disposition",
    `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
