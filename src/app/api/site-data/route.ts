import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Announcement, AdminYear, SiteData } from "@/lib/types";

// Force dynamic: never prerender this route at build time. The route queries
// the database, which is unreachable during the Vercel build (Supabase may be
// sleeping, or the build sandbox has no DB access). CDN-level caching is
// provided by the Cache-Control header below (s-maxage + stale-while-revalidate),
// which gives the same caching behavior as ISR without requiring a DB connection
// at build time. Per 02-system-design.md section 6 (graceful degradation).
export const dynamic = "force-dynamic";

/** GET /api/site-data - public, returns all announcements + officer years. */
export async function GET() {
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
  // Public, cacheable for 60s at the CDN, stale-while-revalidate for 300s.
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300",
  );
  return res;
}
