import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseLinks } from "@/lib/announcements";
import type { Announcement, AdminYear, SiteData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [annRows, yearRows] = await Promise.all([
      withDbRetry(() =>
        db.announcement.findMany({
          orderBy: [
            { pinned: "desc" },
            { date: "desc" },
            { createdAt: "desc" },
          ],
          take: 200,
        }),
      ),
      withDbRetry(() =>
        db.adminYear.findMany({
          include: { officers: { orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" },
          take: 100,
        }),
      ),
    ]);

    const announcements: Announcement[] = annRows.map((r) => ({
      id: r.id,
      type: r.type as Announcement["type"],
      title: r.title,
      body: r.body,
      image: r.image,
      links: parseLinks(r.links),
      pinned: r.pinned,
      date: r.date,
    }));

    const adminYears: AdminYear[] = yearRows.map((y) => ({
      id: y.id,
      year: y.year,
      theme: y.theme,
      sortOrder: y.sortOrder,
      officers: y.officers.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
        image: o.image,
        sortOrder: o.sortOrder,
        reportsToId: o.reportsToId ?? null,
      })),
    }));

    const data: SiteData = { announcements, adminYears };
    const res = NextResponse.json({ data });
    res.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return res;
  } catch (e) {
    logger.warn("site-data DB query failed, returning empty data", {
      error: String(e),
    });
    const empty: SiteData = { announcements: [], adminYears: [] };
    const res = NextResponse.json({ data: empty });

    res.headers.set("Cache-Control", "public, max-age=10");
    return res;
  }
}
