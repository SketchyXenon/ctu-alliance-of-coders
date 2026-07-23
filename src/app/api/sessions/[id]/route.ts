import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sessionDisplayId } from "../route";

/**
 * DELETE /api/sessions/[id] - revoke a specific session.
 * `id` is a non-reversible surrogate (SHA-256 prefix of the real session
 * token). Cannot revoke the current session (use /api/auth/logout instead).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const store = await cookies();
  const currentSessionId = store.get(SESSION_COOKIE)?.value;

  // Compare surrogate ids so the raw token never leaves the server.
  if (currentSessionId && sessionDisplayId(currentSessionId) === id) {
    return NextResponse.json(
      { error: "Use sign out to end your current session." },
      { status: 400 }
    );
  }

  // Resolve the surrogate back to the real session by scanning the caller's
  // sessions (max 5 per user, so this is a cheap lookup).
  const userSessions = await db.adminSession.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const target = userSessions.find((s) => sessionDisplayId(s.id) === id);

  if (!target) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  await db.adminSession.delete({ where: { id: target.id } });

  await logActivity({
    userId: user.id,
    action: "delete",
    entity: "session",
    entityId: target.id,
    summary: "Revoked a session",
  });

  return NextResponse.json({ ok: true });
}
