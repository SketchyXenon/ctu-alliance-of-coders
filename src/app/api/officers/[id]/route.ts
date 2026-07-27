import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { wouldCreateCycle } from "@/lib/org-chart";
import type { Officer } from "@/lib/types";

/** PATCH /api/officers/[id] - admin only, update name/role/image/reportsToId. */
export const PATCH = withPrismaError(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimit(`officer-update:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      );
    }

    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const existing = await db.officer.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Officer not found." },
        { status: 404 },
      );
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const c = validateText(body.name, { required: false, maxLen: 80 });
      if (!c.valid)
        return NextResponse.json({ error: c.error }, { status: 400 });
      data.name = String(body.name).trim() || "Vacant Slot";
    }
    if (body.role !== undefined) {
      const c = validateText(body.role, { required: false, maxLen: 80 });
      if (!c.valid)
        return NextResponse.json({ error: c.error }, { status: 400 });
      data.role = String(body.role).trim() || "Open Position";
    }
    if (body.image !== undefined) {
      // Validate image URL (S1): reject javascript:, data:, off-domain http, etc.
      const imgCheck = validateImageUrl(body.image);
      if (!imgCheck.valid)
        return NextResponse.json({ error: imgCheck.error }, { status: 400 });
      data.image = imgCheck.normalized;
    }
    if (body.sortOrder !== undefined) {
      const sortNum = Number(body.sortOrder);
      if (!Number.isInteger(sortNum) || sortNum < 0) {
        return NextResponse.json(
          { error: "sortOrder must be a non-negative integer." },
          { status: 400 },
        );
      }
      data.sortOrder = sortNum;
    }
    if (body.reportsToId !== undefined) {
      const raw =
        body.reportsToId === null || body.reportsToId === ""
          ? null
          : String(body.reportsToId);
      if (raw !== null) {
        // Same-year + cycle checks. Per 06 section 3 (IDOR): the parent must
        // belong to the same year; a cross-year parent id is rejected. Per 02
        // section 6: cycle check before the write.
        const parent = await db.officer.findUnique({ where: { id: raw } });
        if (!parent || parent.yearId !== existing.yearId) {
          return NextResponse.json(
            { error: "Parent officer must belong to the same year." },
            { status: 400 },
          );
        }
        const siblings = await db.officer.findMany({
          where: { yearId: existing.yearId },
          select: { id: true, reportsToId: true },
        });
        if (wouldCreateCycle(id, raw, siblings)) {
          return NextResponse.json(
            {
              error:
                "That parent would create a reporting cycle. Choose a different parent.",
            },
            { status: 400 },
          );
        }
      }
      data.reportsToId = raw;
    }

    // If no fields to update, return the existing record (no-op).
    if (Object.keys(data).length === 0) {
      const item: Officer = {
        id: existing.id,
        name: existing.name,
        role: existing.role,
        image: existing.image,
        sortOrder: existing.sortOrder,
        reportsToId: existing.reportsToId ?? null,
      };
      return NextResponse.json({ item });
    }

    const updated = await db.officer.update({ where: { id }, data });
    const item: Officer = {
      id: updated.id,
      name: updated.name,
      role: updated.role,
      image: updated.image,
      sortOrder: updated.sortOrder,
      reportsToId: updated.reportsToId ?? null,
    };

    await logActivity({
      userId: user.id,
      action: "update",
      entity: "officer",
      entityId: updated.id,
      summary: `Updated officer: ${updated.name} (${updated.role})`,
    });

    return NextResponse.json({ item });
  },
);

/** DELETE /api/officers/[id] - admin only. */
export const DELETE = withPrismaError(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimit(`officer-delete:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      );
    }

    const { id } = await params;
    const existing = await db.officer.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Officer not found." },
        { status: 404 },
      );
    }
    await db.officer.delete({ where: { id } });

    await logActivity({
      userId: user.id,
      action: "delete",
      entity: "officer",
      entityId: id,
      summary: `Removed officer: ${existing.name} (${existing.role})`,
    });

    return NextResponse.json({ ok: true });
  },
);
