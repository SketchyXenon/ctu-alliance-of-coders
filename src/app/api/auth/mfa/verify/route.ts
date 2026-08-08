import { NextResponse } from "next/server";
import { verifyMfaChallenge, MFA_MAX_ATTEMPTS } from "@/lib/mfa";
import { createSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, maskEmail } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

const GENERIC_FAIL = "Invalid or expired verification code.";

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`mfa-verify-ip:${ip}`, 10, 60_000);
  if (!ipLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
          },
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

  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId : "";
  const code =
    typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const result = await verifyMfaChallenge(challengeId, code);
  if (!result.ok || !result.userId) {
    if (result.locked) {
      return withCache(
        NextResponse.json(
          { error: "Too many attempts. Please request a new code." },
          {
            status: 429,
            headers: {
              "Retry-After": String(
                Math.ceil((result.retryAfterMs ?? 0) / 1000),
              ),
            },
          },
        ),
        CACHE_NO_STORE,
      );
    }
    logger.warn("MFA verify failed", { reason: result.reason, ip });
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const user = await db.adminUser.findUnique({
    where: { id: result.userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user || !isAdminRole(user.role) || user.active === false) {
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  await createSession(user.id);
  await logActivity({
    userId: user.id,
    action: "login",
    entity: "admin_mfa",
    summary: `Admin completed MFA sign-in: ${maskEmail(user.email)}`,
  });

  return withCache(
    NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      attemptsLeft: MFA_MAX_ATTEMPTS,
    }),
    CACHE_NO_STORE,
  );
});
