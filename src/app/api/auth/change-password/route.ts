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
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { cookies } from "next/headers";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export const POST = withPrismaError(async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`change-password:${user.id}`, 3, 10 * 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many attempts. Please wait." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const currentCheck = validatePassword(body.currentPassword, {
    minLen: 1,
    maxLen: MAX_PASSWORD,
  });
  if (!currentCheck.valid || !currentCheck.value) {
    return withCache(
      NextResponse.json({ error: currentCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  const newCheck = validatePassword(body.newPassword, {
    minLen: MIN_PASSWORD,
    maxLen: MAX_PASSWORD,
  });
  if (!newCheck.valid || !newCheck.value) {
    return withCache(
      NextResponse.json({ error: newCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const currentPassword = currentCheck.value;
  const newPassword = newCheck.value;

  if (currentPassword === newPassword) {
    return withCache(
      NextResponse.json(
        { error: "New password must differ from current." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const adminUser = await db.adminUser.findUnique({ where: { id: user.id } });
  if (!adminUser) {
    return withCache(
      NextResponse.json({ error: "User not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  const passwordOk = await verifyPassword(
    currentPassword,
    adminUser.passwordHash,
  );
  if (!passwordOk) {
    logger.warn("Failed password change", { userId: user.id });
    return withCache(
      NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 403 },
      ),
      CACHE_NO_STORE,
    );
  }

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

  if (currentSessionId) {
    try {
      await rotateSession(currentSessionId);
    } catch (e) {
      const isMissing = e instanceof SessionNotFoundError;
      logger.warn(
        isMissing
          ? "Session expired during password change"
          : "Session rotation failed after password change",
        { userId: user.id, error: isMissing ? undefined : String(e) },
      );
      return withCache(
        NextResponse.json(
          {
            error:
              "Your password was changed, but your session could not be refreshed. Please log in again with your new password.",
          },
          { status: 401 },
        ),
        CACHE_NO_STORE,
      );
    }
  }

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "session",
    summary: "Changed admin password",
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});
