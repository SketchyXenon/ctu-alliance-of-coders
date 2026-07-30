import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import type {
  ContactMessage,
  ContactCategory,
  ContactStatus,
} from "@/lib/types";

const VALID_STATUSES: ContactStatus[] = ["new", "read", "resolved", "archived"];

/** PATCH /api/contact/[id] - admin only, update status.
 *  Wrapped with withPrismaError so DB-down returns a clean 503 (03 §6).
 *  Per-admin rate limit (20/min) so a compromised session can't spam
 *  status flips (06 section 7). */
export const PATCH = withPrismaError(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`contact-update:${user.id}`, 20, 60_000);
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

  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return withCache(
      NextResponse.json({ error: "Message not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!VALID_STATUSES.includes(status as ContactStatus)) {
      return withCache(
        NextResponse.json({ error: "Invalid status." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    const updated = await db.contactMessage.update({
      where: { id },
      data: { status },
    });
    const item: ContactMessage = {
      id: updated.id,
      clientId: updated.clientId,
      name: updated.name,
      email: updated.email,
      subject: updated.subject,
      category: updated.category as ContactCategory,
      message: updated.message,
      status: updated.status as ContactStatus,
      createdAt: updated.createdAt.toISOString(),
    };

    await logActivity({
      userId: user.id,
      action: "update",
      entity: "message",
      entityId: id,
      summary: `Marked message "${existing.subject}" as ${status}`,
    });

    return withCache(NextResponse.json({ item }), CACHE_NO_STORE);
  }

  return withCache(
    NextResponse.json({ error: "Nothing to update." }, { status: 400 }),
    CACHE_NO_STORE,
  );
});

/** DELETE /api/contact/[id] - admin only.
 *  Wrapped with withPrismaError so DB-down returns a clean 503 (03 §6).
 *  Per-admin rate limit (20/min) — mirrors PATCH (06 section 7). */
export const DELETE = withPrismaError(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`contact-update:${user.id}`, 20, 60_000);
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

  const { id } = await params;
  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return withCache(
      NextResponse.json({ error: "Message not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }
  await db.contactMessage.delete({ where: { id } });

  await logActivity({
    userId: user.id,
    action: "delete",
    entity: "message",
    entityId: id,
    summary: `Deleted message: ${existing.subject}`,
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});
