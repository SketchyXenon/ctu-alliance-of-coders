import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import type { AdminYear } from "@/lib/types";

/** GET /api/admin-years - public, with officers. Cached for 60s. */
export async function GET() {
  const years = await db.adminYear.findMany({
    include: { officers: { orderBy: { sortOrder: "asc" } } },
    orderBy: { sortOrder: "asc" },
    take: 100,
  });
  const items: AdminYear[] = years.map((y) => ({
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
  const res = NextResponse.json({ items });
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}

/** POST /api/admin-years - admin only, create a new leadership year. */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // S8: rate limit was missing on this endpoint.
  const rl = rateLimit(`year-create:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const yearCheck = validateText(body.year, { required: true, minLen: 4, maxLen: 30 });
  if (!yearCheck.valid) return NextResponse.json({ error: yearCheck.error }, { status: 400 });

  const themeCheck = validateText(body.theme, { required: false, maxLen: 200 });
  if (!themeCheck.valid) return NextResponse.json({ error: themeCheck.error }, { status: 400 });

  // Transaction: get max sortOrder + create atomically (fixes TOCTOU on sort-order).
  const created = await db.$transaction(async (tx) => {
    const maxSort = await tx.adminYear.aggregate({ _max: { sortOrder: true } });
    return tx.adminYear.create({
      data: {
        year: String(body.year).trim(),
        theme: body.theme ? String(body.theme).trim() : "Set a leadership theme for this year.",
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
      include: { officers: true },
    });
  });

  const item: AdminYear = {
    id: created.id,
    year: created.year,
    theme: created.theme,
    sortOrder: created.sortOrder,
    officers: created.officers.map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      image: o.image,
      sortOrder: o.sortOrder,
    })),
  };

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "year",
    entityId: created.id,
    summary: `Created year: ${created.year}`,
  });

  return NextResponse.json({ item }, { status: 201 });
});
