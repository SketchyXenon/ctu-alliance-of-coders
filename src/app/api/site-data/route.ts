import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Announcement, AdminYear, SiteData } from "@/lib/types";

// Force dynamic: never prerender this route at build time. The route queries
// the database, which is unreachable during the Vercel build (Supabase may be
// sleeping, or the build sandbox has no DB access). CDN-level caching is
// provided by the Cache-Control header below (s-maxage + stale-while-revalidate),
// which gives the same caching behavior as ISR without requiring a DB connection
// at build time. Per 02-system-design.md section 6 (graceful degradation).
export const dynamic = "force-dynamic";

/** GET /api/site-data - public, returns all announcements + officer years.
 *  Graceful degradation: if the DB is unreachable, returns empty arrays with
 *  a 200 so the page renders with empty states instead of crashing (02 §6). */
export async function GET() {
  try {
    const [annRows, yearRows] = await Promise.all([
      db.announcement.findMany({
        orderBy: [{ pinned: "desc" }, { date: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
      db.adminYear.findMany({
        include: { officers: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
        take: 100,
      }),
    ]);

    const announcements: Announcement[] = annRows.map((r) => ({
      id: r.id,
      type: r.type as Announcement["type"],
      title: r.title,
      body: r.body,
      image: r.image,
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
    // DB unreachable: return empty data so the page renders with empty states.
    // Per 02 section 6: "a partial result beats a hard failure."
    logger.warn("site-data DB query failed, returning empty data", {
      error: String(e),
    });
    const empty: SiteData = { announcements: [], adminYears: [] };
    const res = NextResponse.json({ data: empty });
    // Short cache so clients retry quickly when the DB recovers.
    res.headers.set("Cache-Control", "public, max-age=10");
    return res;
  }
}
