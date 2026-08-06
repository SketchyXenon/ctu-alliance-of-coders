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

export const PATCH = withPrismaError(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return withCache(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        CACHE_NO_STORE,
      );
    }

    const rl = rateLimit(`officer-update:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return withCache(
        NextResponse.json(
          { error: "Too many requests." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
            },
          },
        ),
        CACHE_NO_STORE,
      );
    }

    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return withCache(
        NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }

    const existing = await db.officer.findUnique({ where: { id } });
    if (!existing) {
      return withCache(
        NextResponse.json({ error: "Officer not found." }, { status: 404 }),
        CACHE_NO_STORE,
      );
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const c = validateText(body.name, { required: false, maxLen: 80 });
      if (!c.valid)
        return withCache(
          NextResponse.json({ error: c.error }, { status: 400 }),
          CACHE_NO_STORE,
        );
      data.name = String(body.name).trim() || "Vacant Slot";
    }
    if (body.role !== undefined) {
      const c = validateText(body.role, { required: false, maxLen: 80 });
      if (!c.valid)
        return withCache(
          NextResponse.json({ error: c.error }, { status: 400 }),
          CACHE_NO_STORE,
        );
      data.role = String(body.role).trim() || "Open Position";
    }
    if (body.image !== undefined) {
      const imgCheck = validateImageUrl(body.image);
      if (!imgCheck.valid)
        return withCache(
          NextResponse.json({ error: imgCheck.error }, { status: 400 }),
          CACHE_NO_STORE,
        );
      data.image = imgCheck.normalized;
    }
    if (body.sortOrder !== undefined) {
      const sortNum = Number(body.sortOrder);
      if (!Number.isInteger(sortNum) || sortNum < 0) {
        return withCache(
          NextResponse.json(
            { error: "sortOrder must be a non-negative integer." },
            { status: 400 },
          ),
          CACHE_NO_STORE,
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
        const parent = await db.officer.findUnique({ where: { id: raw } });
        if (!parent || parent.yearId !== existing.yearId) {
          return withCache(
            NextResponse.json(
              { error: "Parent officer must belong to the same year." },
              { status: 400 },
            ),
            CACHE_NO_STORE,
          );
        }
        const siblings = await db.officer.findMany({
          where: { yearId: existing.yearId },
          select: { id: true, reportsToId: true },
        });
        if (wouldCreateCycle(id, raw, siblings)) {
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
      }
      data.reportsToId = raw;
    }

    if (Object.keys(data).length === 0) {
      const item: Officer = {
        id: existing.id,
        name: existing.name,
        role: existing.role,
        image: existing.image,
        sortOrder: existing.sortOrder,
        reportsToId: existing.reportsToId ?? null,
      };
      return withCache(NextResponse.json({ item }), CACHE_NO_STORE);
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

    return withCache(NextResponse.json({ item }), CACHE_NO_STORE);
  },
);

export const DELETE = withPrismaError(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    let user;
    try {
      user = await requireAdmin();
    } catch {
      return withCache(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        CACHE_NO_STORE,
      );
    }

    const rl = rateLimit(`officer-delete:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return withCache(
        NextResponse.json(
          { error: "Too many requests." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
            },
          },
        ),
        CACHE_NO_STORE,
      );
    }

    const { id } = await params;
    const existing = await db.officer.findUnique({ where: { id } });
    if (!existing) {
      return withCache(
        NextResponse.json({ error: "Officer not found." }, { status: 404 }),
        CACHE_NO_STORE,
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

    return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
  },
);
