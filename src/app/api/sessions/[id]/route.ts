import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { sessionDisplayId } from "../route";

export const DELETE = withPrismaError(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`session-revoke:${user.id}`, 10, 60_000);
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
  const store = await cookies();
  const currentSessionId = store.get(SESSION_COOKIE)?.value;

  if (currentSessionId && sessionDisplayId(currentSessionId) === id) {
    return withCache(
      NextResponse.json(
        { error: "Use sign out to end your current session." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const userSessions = await db.adminSession.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const target = userSessions.find((s) => sessionDisplayId(s.id) === id);

  if (!target) {
    return withCache(
      NextResponse.json({ error: "Session not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  await db.adminSession.delete({ where: { id: target.id } });

  await logActivity({
    userId: user.id,
    action: "delete",
    entity: "session",
    entityId: target.id,
    summary: "Revoked a session",
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});
