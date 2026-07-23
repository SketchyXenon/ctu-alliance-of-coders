import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

/**
 * GET /api/announcements/export - admin only, returns CSV.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { date: "desc" }],
    take: 500,
  });

  const header = "id,type,title,date,pinned,image\n";
  const body = rows
    .map((r) => {
      const title = csvEscape(r.title);
      const image = r.image ? csvEscape(r.image) : "";
      return `${r.id},${r.type},${title},${r.date},${r.pinned},${image}`;
    })
    .join("\n");

  const csv = header + body;
  const res = new NextResponse(csv);
  res.headers.set("Content-Type", "text/csv; charset=utf-8");
  res.headers.set(
    "Content-Disposition",
    `attachment; filename="announcements-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
