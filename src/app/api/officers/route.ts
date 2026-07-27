import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { logActivity } from "@/lib/activity";
import { wouldCreateCycle } from "@/lib/org-chart";
import type { Officer } from "@/lib/types";

/** POST /api/officers - admin only, create an officer slot in a year. */
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

  const rl = rateLimit(`officer-create:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests." },
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

  const yearId = String(body.yearId ?? "");
  if (!yearId) {
    return withCache(
      NextResponse.json({ error: "yearId is required." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const year = await db.adminYear.findUnique({ where: { id: yearId } });
  if (!year) {
    return withCache(
      NextResponse.json({ error: "Year not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  const nameCheck = validateText(body.name, { required: false, maxLen: 80 });
  if (!nameCheck.valid)
    return withCache(
      NextResponse.json({ error: nameCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  const roleCheck = validateText(body.role, { required: false, maxLen: 80 });
  if (!roleCheck.valid)
    return withCache(
      NextResponse.json({ error: roleCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  // Validate image URL (S1): reject javascript:, data:, off-domain http, etc.
  const imageCheck = validateImageUrl(body.image);
  if (!imageCheck.valid)
    return withCache(
      NextResponse.json({ error: imageCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  // Validate reportsToId (org-chart parent): same year + no cycle. Per 06
  // section 3: re-authorize every object access server-side; a parent id from
  // another year is an IDOR attempt. Per 02 section 6: cycle check before the
  // write so the data stays renderable.
  let reportsToId: string | null = null;
  if (
    body.reportsToId !== undefined &&
    body.reportsToId !== null &&
    body.reportsToId !== ""
  ) {
    const raw = String(body.reportsToId);
    const parent = await db.officer.findUnique({ where: { id: raw } });
    if (!parent || parent.yearId !== yearId) {
      return withCache(
        NextResponse.json(
          { error: "Parent officer must belong to the same year." },
          { status: 400 },
        ),
        CACHE_NO_STORE,
      );
    }
    // A new officer has no id yet, so it can't form a cycle by being assigned
    // a parent — but we still guard against the parent referencing itself if a
    // future code path ever passes the new id pre-create.
    const siblings = await db.officer.findMany({
      where: { yearId },
      select: { id: true, reportsToId: true },
    });
    if (wouldCreateCycle(raw, parent.reportsToId, siblings)) {
      return withCache(
        NextResponse.json(
          {
            error:
              "That parent would create a reporting cycle. Choose a different parent.",
          },
          { status: 400 },
        ),
        CACHE_NO_STORE,
      );
    }
    reportsToId = raw;
  }

  // Transaction: aggregate + create atomically (fixes TOCTOU on sort-order).
  const created = await db.$transaction(async (tx) => {
    const maxSort = await tx.officer.aggregate({
      where: { yearId },
      _max: { sortOrder: true },
    });
    return tx.officer.create({
      data: {
        yearId,
        name: body.name ? String(body.name).trim() : "Vacant Slot",
        role: body.role ? String(body.role).trim() : "Open Position",
        image: imageCheck.normalized,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        reportsToId,
      },
    });
  });

  const item: Officer = {
    id: created.id,
    name: created.name,
    role: created.role,
    image: created.image,
    sortOrder: created.sortOrder,
    reportsToId: created.reportsToId ?? null,
  };

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "officer",
    entityId: created.id,
    summary: `Added officer: ${created.name} (${created.role})`,
  });

  return withCache(
    NextResponse.json({ item }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
