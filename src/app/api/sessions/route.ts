import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { withPrismaError } from "@/lib/route-helpers";
import { cookies } from "next/headers";

// H2 fix: never expose the raw session token (which IS the httpOnly cookie
// value) in JSON. An XSS or log exfiltration could replay it directly as the
// cookie. Instead, expose a non-reversible SHA-256 prefix as a surrogate id.
// DELETE resolves the surrogate back to the real session by scanning the
// caller's (max 5) sessions.
function sessionDisplayId(rawId: string): string {
  return createHash("sha256").update(rawId).digest("hex").slice(0, 16);
}

/**
 * GET /api/sessions - list active sessions for the current user.
 * Returns surrogate display ids, never the raw session token.
 * Wrapped in withPrismaError so DB-down returns a clean 503, not a raw 500
 * (defense-in-depth: getCurrentUser already fails closed, but this closes the
 * TOCTOU window if the DB drops between auth and the findMany).
 */
export const GET = withPrismaError(async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = await cookies();
  const currentSessionId = store.get(SESSION_COOKIE)?.value;

  const now = new Date();
  const sessions = await db.adminSession.findMany({
    where: {
      userId: user.id,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  const items = sessions.map((s) => ({
    id: sessionDisplayId(s.id),
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    isCurrent: s.id === currentSessionId,
  }));

  const res = NextResponse.json({ items });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

export { sessionDisplayId };
