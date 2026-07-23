import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import type { Announcement, AnnouncementType } from "@/lib/types";
import { ANNOUNCEMENT_TYPES } from "@/lib/constants";

const MAX_BODY = 5000;

/** PATCH /api/announcements/[id] - admin only, update fields. */
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

    const rl = rateLimit(`ann-update:${user.id}`, 20, 60_000);
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

    const existing = await db.announcement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const c = validateText(body.title, { required: true, minLen: 5, maxLen: 200 });
      if (!c.valid) return NextResponse.json({ error: c.error }, { status: 400 });
      data.title = String(body.title).trim();
    }
    if (body.body !== undefined) {
      const c = validateText(body.body, { required: true, minLen: 10, maxLen: MAX_BODY });
      if (!c.valid) return NextResponse.json({ error: c.error }, { status: 400 });
      data.body = String(body.body).trim();
    }
    if (body.type !== undefined) {
      if (!ANNOUNCEMENT_TYPES.includes(body.type as AnnouncementType)) {
        return NextResponse.json({ error: "Invalid type." }, { status: 400 });
      }
      data.type = String(body.type);
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== "boolean") {
        return NextResponse.json({ error: "pinned must be a boolean." }, { status: 400 });
      }
      data.pinned = body.pinned;
    }
    if (body.image !== undefined) {
      // Validate image URL (S1): reject javascript:, data:, off-domain http, etc.
      const imgCheck = validateImageUrl(body.image);
      if (!imgCheck.valid) return NextResponse.json({ error: imgCheck.error }, { status: 400 });
      data.image = imgCheck.normalized;
    }

    const updated = await db.announcement.update({ where: { id }, data });
    const item: Announcement = {
      id: updated.id,
      type: updated.type as AnnouncementType,
      title: updated.title,
      body: updated.body,
      image: updated.image,
      pinned: updated.pinned,
      date: updated.date,
    };

    await logActivity({
      userId: user.id,
      action: "update",
      entity: "announcement",
      entityId: updated.id,
      summary: `Updated announcement: ${updated.title}`,
    });

    return NextResponse.json({ item });
  }
);

/** DELETE /api/announcements/[id] - admin only. */
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

    const rl = rateLimit(`ann-delete:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const { id } = await params;
    const existing = await db.announcement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
    }
    await db.announcement.delete({ where: { id } });

    await logActivity({
      userId: user.id,
      action: "delete",
      entity: "announcement",
      entityId: id,
      summary: `Deleted announcement: ${existing.title}`,
    });

    return NextResponse.json({ ok: true });
  }
);
