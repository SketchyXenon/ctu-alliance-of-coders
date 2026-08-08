import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, ROLE_SUPER_ADMIN } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

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

  const admins = await db.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, expiresAt: true },
      },
    },
  });

  const viewerIsSuperAdmin = user.role === ROLE_SUPER_ADMIN;
  const items = admins.map((a) => {
    const lastSession = a.sessions[0];
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      active: a.active,
      createdAt: a.createdAt.toISOString(),
      lastActiveAt: lastSession ? lastSession.createdAt.toISOString() : null,
      sessionExpiresAt: lastSession
        ? lastSession.expiresAt.toISOString()
        : null,
      isSelf: a.id === user.id,
      canManage:
        viewerIsSuperAdmin && a.id !== user.id && a.role !== ROLE_SUPER_ADMIN,
    };
  });

  await logActivity({
    userId: user.id,
    action: "view",
    entity: "admin_user",
    summary: `Viewed admin users list (${items.length} accounts)`,
  });

  return withCache(
    NextResponse.json({ items, viewerIsSuperAdmin }),
    CACHE_NO_STORE,
  );
});
