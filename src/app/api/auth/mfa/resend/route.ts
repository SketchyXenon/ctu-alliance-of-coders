import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdminRole } from "@/lib/auth";
import { createMfaChallenge, MFA_RESEND_COOLDOWN_MS } from "@/lib/mfa";
import { rateLimit, getClientIp, maskEmail } from "@/lib/security";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

const TOO_SOON_MSG = "Please wait before requesting a new code.";

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`mfa-resend-ip:${ip}`, 3, 10 * 60_000);
  if (!ipLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please try again later." },
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
  if (!challengeId) {
    return withCache(
      NextResponse.json({ error: "Invalid request." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const challenge = await db.adminMfaChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      consumed: true,
      expiresAt: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });

  if (!challenge || !challenge.user || !isAdminRole(challenge.user.role)) {
    return withCache(
      NextResponse.json({ error: "Invalid request." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  if (challenge.consumed) {
    return withCache(
      NextResponse.json(
        { error: "This code has already been used." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const ageMs = Date.now() - challenge.createdAt.getTime();
  if (ageMs < MFA_RESEND_COOLDOWN_MS) {
    const retryAfterMs = MFA_RESEND_COOLDOWN_MS - ageMs;
    return withCache(
      NextResponse.json(
        { error: TOO_SOON_MSG },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const created = await createMfaChallenge(
    challenge.user.id,
    challenge.user.email,
  );
  logger.info("MFA code resent", {
    userId: challenge.user.id,
    email: maskEmail(challenge.user.email),
  });

  return withCache(
    NextResponse.json({
      challengeId: created.challengeId,
      delivered: created.delivered,
      resendAvailableIn: Math.ceil(MFA_RESEND_COOLDOWN_MS / 1000),
    }),
    CACHE_NO_STORE,
  );
});
