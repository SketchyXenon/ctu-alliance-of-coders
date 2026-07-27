import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  rotateSession,
  SessionNotFoundError,
  SESSION_COOKIE,
} from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { cookies } from "next/headers";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/**
 * POST /api/auth/change-password - admin changes own password.
 * Rotates session ID and revokes all other sessions.
 *
 * Per 06-security-architecture.md section 2: rotate the session identifier on
 * any privilege change. Per 02 section 6: atomic operations to close TOCTOU.
 * Per A2/A8 fix: the password update and the "revoke other sessions" delete
 * run in a SINGLE transaction (atomic — either both land or neither does),
 * and rotateSession throws SessionNotFoundError if the session was concurrently
 * revoked, so we return 401 (fail closed) instead of 200 with a stale cookie.
 *
 * Wrapped in withPrismaError so a race in rotateSession (P2025) returns a
 * clean error instead of a raw 500 with the password already changed (M6).
 */
export const POST = withPrismaError(async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`change-password:${user.id}`, 3, 10 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate current and new passwords WITHOUT display-field XSS blocklists
  // (S2: strong passwords may legitimately contain "<script" etc.).
  const currentCheck = validatePassword(body.currentPassword, {
    minLen: 1,
    maxLen: MAX_PASSWORD,
  });
  if (!currentCheck.valid || !currentCheck.value) {
    return NextResponse.json({ error: currentCheck.error }, { status: 400 });
  }
  const newCheck = validatePassword(body.newPassword, {
    minLen: MIN_PASSWORD,
    maxLen: MAX_PASSWORD,
  });
  if (!newCheck.valid || !newCheck.value) {
    return NextResponse.json({ error: newCheck.error }, { status: 400 });
  }

  const currentPassword = currentCheck.value;
  const newPassword = newCheck.value;

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must differ from current." },
      { status: 400 },
    );
  }

  const adminUser = await db.adminUser.findUnique({ where: { id: user.id } });
  if (!adminUser) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const passwordOk = await verifyPassword(
    currentPassword,
    adminUser.passwordHash,
  );
  if (!passwordOk) {
    logger.warn("Failed password change", { userId: user.id });
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 403 },
    );
  }

  // Single transaction: password update + revoke all other sessions.
  // Atomic (A2 fix): if either fails, NEITHER lands, so we never end up with
  // a changed password but live other-sessions, or vice-versa. Per 02 section 6.
  const newHash = await hashPassword(newPassword);
  const store = await cookies();
  const currentSessionId = store.get(SESSION_COOKIE)?.value;

  await db.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
    if (currentSessionId) {
      await tx.adminSession.deleteMany({
        where: { userId: user.id, NOT: { id: currentSessionId } },
      });
    }
  });

  // Rotate the current session id (separate — sets a cookie, can't be inside
  // the DB transaction cleanly). If the session was concurrently revoked,
  // rotateSession throws SessionNotFoundError: the password + revocation above
  // already succeeded (security maintained), so we tell the user to re-login
  // rather than returning 200 with a stale cookie (A2 fail-closed fix).
  if (currentSessionId) {
    try {
      await rotateSession(currentSessionId);
    } catch (e) {
      if (e instanceof SessionNotFoundError) {
        logger.warn("Session expired during password change", {
          userId: user.id,
        });
        return NextResponse.json(
          {
            error:
              "Your session has expired. Please log in again with your new password.",
          },
          { status: 401 },
        );
      }
      throw e;
    }
  }

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "session",
    summary: "Changed admin password",
  });

  return NextResponse.json({ ok: true });
});
