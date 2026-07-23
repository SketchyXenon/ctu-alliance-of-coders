import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  destroyOtherSessions,
  rotateSession,
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
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
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
  const currentCheck = validatePassword(body.currentPassword, { minLen: 1, maxLen: MAX_PASSWORD });
  if (!currentCheck.valid || !currentCheck.value) {
    return NextResponse.json({ error: currentCheck.error }, { status: 400 });
  }
  const newCheck = validatePassword(body.newPassword, { minLen: MIN_PASSWORD, maxLen: MAX_PASSWORD });
  if (!newCheck.valid || !newCheck.value) {
    return NextResponse.json({ error: newCheck.error }, { status: 400 });
  }

  const currentPassword = currentCheck.value;
  const newPassword = newCheck.value;

  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "New password must differ from current." }, { status: 400 });
  }

  const adminUser = await db.adminUser.findUnique({ where: { id: user.id } });
  if (!adminUser) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const passwordOk = await verifyPassword(currentPassword, adminUser.passwordHash);
  if (!passwordOk) {
    logger.warn("Failed password change", { userId: user.id });
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  // Update password hash.
  const newHash = await hashPassword(newPassword);
  await db.adminUser.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  // Rotate session ID and revoke all other sessions.
  const store = await cookies();
  const currentSessionId = store.get(SESSION_COOKIE)?.value;
  if (currentSessionId) {
    await destroyOtherSessions(user.id, currentSessionId);
    await rotateSession(currentSessionId);
  }

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "session",
    summary: "Changed admin password",
  });

  return NextResponse.json({ ok: true });
});
