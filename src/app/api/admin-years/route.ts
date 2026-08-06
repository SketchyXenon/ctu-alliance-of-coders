import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import type { AdminYear } from "@/lib/types";

export async function GET() {
  try {
    const years = await withDbRetry(() =>
      db.adminYear.findMany({
        include: { officers: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
        take: 100,
      }),
    );
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
        reportsToId: o.reportsToId ?? null,
      })),
    }));
    const res = NextResponse.json({ items });
    res.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return res;
  } catch (e) {
    logger.warn("admin-years DB query failed, returning empty list", {
      error: String(e),
    });
    const res = NextResponse.json({ items: [] });
    res.headers.set("Cache-Control", "public, max-age=10");
    return res;
  }
}

export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }
  const rl = rateLimit(`year-create:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const yearCheck = validateText(body.year, {
    required: true,
    minLen: 4,
    maxLen: 30,
  });
  if (!yearCheck.valid)
    return withCache(
      NextResponse.json({ error: yearCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const themeCheck = validateText(body.theme, { required: false, maxLen: 200 });
  if (!themeCheck.valid)
    return withCache(
      NextResponse.json({ error: themeCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const created = await db.$transaction(async (tx) => {
    const maxSort = await tx.adminYear.aggregate({ _max: { sortOrder: true } });
    return tx.adminYear.create({
      data: {
        year: String(body.year).trim(),
        theme: body.theme
          ? String(body.theme).trim()
          : "Set a leadership theme for this year.",
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
      reportsToId: o.reportsToId ?? null,
    })),
  };

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "year",
    entityId: created.id,
    summary: `Created year: ${created.year}`,
  });

  return withCache(
    NextResponse.json({ item }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
