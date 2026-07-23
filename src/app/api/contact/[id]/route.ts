import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import type { ContactMessage, ContactCategory, ContactStatus } from "@/lib/types";

const VALID_STATUSES: ContactStatus[] = ["new", "read", "resolved", "archived"];

/** PATCH /api/contact/[id] - admin only, update status. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!VALID_STATUSES.includes(status as ContactStatus)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
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

    return NextResponse.json({ item });
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}

/** DELETE /api/contact/[id] - admin only. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  await db.contactMessage.delete({ where: { id } });

  await logActivity({
    userId: user.id,
    action: "delete",
    entity: "message",
    entityId: id,
    summary: `Deleted message: ${existing.subject}`,
  });

  return NextResponse.json({ ok: true });
}
