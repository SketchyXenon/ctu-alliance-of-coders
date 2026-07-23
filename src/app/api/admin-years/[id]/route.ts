import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import type { AdminYear } from "@/lib/types";

/** PATCH /api/admin-years/[id] - admin only, update year/theme/sortOrder. */
export const PATCH = withPrismaError(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimit(`year-update:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const existing = await db.adminYear.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Year not found." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    const changed: string[] = [];
    if (body.year !== undefined) {
      const c = validateText(body.year, { required: true, minLen: 4, maxLen: 30 });
      if (!c.valid) return NextResponse.json({ error: c.error }, { status: 400 });
      data.year = String(body.year).trim();
      changed.push("year");
    }
    if (body.theme !== undefined) {
      const c = validateText(body.theme, { required: false, maxLen: 200 });
      if (!c.valid) return NextResponse.json({ error: c.error }, { status: 400 });
      data.theme = String(body.theme).trim();
      changed.push("theme");
    }
    if (body.sortOrder !== undefined) {
      const sortNum = Number(body.sortOrder);
      if (!Number.isInteger(sortNum) || sortNum < 0) {
        return NextResponse.json({ error: "sortOrder must be a non-negative integer." }, { status: 400 });
      }
      data.sortOrder = sortNum;
      changed.push("sortOrder");
    }

    const updated = await db.adminYear.update({
      where: { id },
      data,
      include: { officers: { orderBy: { sortOrder: "asc" } } },
    });

    // S5: PATCH on admin-years previously skipped audit logging.
    const summary = changed.length
      ? `Updated year ${existing.year}: ${changed.join(", ")}`
      : `Touched year ${existing.year}`;
    await logActivity({
      userId: user.id,
      action: "update",
      entity: "year",
      entityId: id,
      summary,
    });

    const item: AdminYear = {
      id: updated.id,
      year: updated.year,
      theme: updated.theme,
      sortOrder: updated.sortOrder,
      officers: updated.officers.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
        image: o.image,
        sortOrder: o.sortOrder,
      })),
    };
    return NextResponse.json({ item });
  }
);

/** DELETE /api/admin-years/[id] - admin only, cascades officers. */
export const DELETE = withPrismaError(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimit(`year-delete:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const { id } = await params;
    const existing = await db.adminYear.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Year not found." }, { status: 404 });
    }
    await db.adminYear.delete({ where: { id } });

    await logActivity({
      userId: user.id,
      action: "delete",
      entity: "year",
      entityId: id,
      summary: `Deleted year: ${existing.year}`,
    });

    return NextResponse.json({ ok: true });
  }
);
