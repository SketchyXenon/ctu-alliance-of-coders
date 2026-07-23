import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import type { Officer } from "@/lib/types";

/** POST /api/officers - admin only, create an officer slot in a year. */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`officer-create:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const yearId = String(body.yearId ?? "");
  if (!yearId) {
    return NextResponse.json({ error: "yearId is required." }, { status: 400 });
  }

  const year = await db.adminYear.findUnique({ where: { id: yearId } });
  if (!year) {
    return NextResponse.json({ error: "Year not found." }, { status: 404 });
  }

  const nameCheck = validateText(body.name, { required: false, maxLen: 80 });
  if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.error }, { status: 400 });
  const roleCheck = validateText(body.role, { required: false, maxLen: 80 });
  if (!roleCheck.valid) return NextResponse.json({ error: roleCheck.error }, { status: 400 });

  // Validate image URL (S1): reject javascript:, data:, off-domain http, etc.
  const imageCheck = validateImageUrl(body.image);
  if (!imageCheck.valid) return NextResponse.json({ error: imageCheck.error }, { status: 400 });

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
      },
    });
  });

  const item: Officer = {
    id: created.id,
    name: created.name,
    role: created.role,
    image: created.image,
    sortOrder: created.sortOrder,
  };

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "officer",
    entityId: created.id,
    summary: `Added officer: ${created.name} (${created.role})`,
  });

  return NextResponse.json({ item }, { status: 201 });
});
