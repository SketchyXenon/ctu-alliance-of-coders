import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { buildCsv } from "@/lib/csv";
import { withPrismaError } from "@/lib/route-helpers";

export const GET = withPrismaError(async function GET() {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`csv-export:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
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
    ]),
  );

  const res = new NextResponse(csv);
  res.headers.set("Content-Type", "text/csv; charset=utf-8");
  res.headers.set(
    "Content-Disposition",
    `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
});
