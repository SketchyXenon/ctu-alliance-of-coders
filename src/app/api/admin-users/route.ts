import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * GET /api/admin-users - admin only, lists all admin accounts.
 *
 * Returns each admin's id, email, name, role, createdAt, and lastActiveAt
 * (derived from the most recent session). NEVER returns password hashes.
 * Per 06 section 3: function-level authz (requireAdmin) + per 06 section 8:
 * data minimization (no passwordHash in the response).
 */
export const GET = withPrismaError(async function GET() {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`admin-users-list:${user.id}`, 30, 60_000);
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

  // Fetch all admin users + their most recent session (for last-active).
  // Per 06 section 8: select only the columns we need; never passwordHash.
  const admins = await db.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, expiresAt: true },
      },
    },
  });

  const items = admins.map((a) => {
    const lastSession = a.sessions[0];
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      createdAt: a.createdAt.toISOString(),
      lastActiveAt: lastSession ? lastSession.createdAt.toISOString() : null,
      sessionExpiresAt: lastSession
        ? lastSession.expiresAt.toISOString()
        : null,
      isSelf: a.id === user.id,
    };
  });

  await logActivity({
    userId: user.id,
    action: "login", // reuses the "view" semantic; the activity log is admin-audited
    entity: "session",
    summary: `Viewed admin users list (${items.length} accounts)`,
  });

  return withCache(NextResponse.json({ items }), CACHE_NO_STORE);
});
