import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import {
  validateEmail,
  rateLimit,
  getClientIp,
  maskEmail,
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

export const DUMMY_HASH =
  "deadbeefdeadbeefdeadbeefdeadbeef:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export const LOGIN_FAILURE_MESSAGE = "Invalid email or password.";
export function loginFailureResponse() {
  return withCache(
    NextResponse.json({ error: LOGIN_FAILURE_MESSAGE }, { status: 401 }),
    CACHE_NO_STORE,
  );
}

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`login-ip:${ip}`, 5, 60_000);
  if (!ipLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
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

  const emailCheck = validateEmail(body.email);
  const passCheck = validatePassword(body.password, { minLen: 1, maxLen: 128 });
  if (!emailCheck.valid || !passCheck.valid || !passCheck.value) {
    // Enumeration-safe: same response for invalid format.
    return loginFailureResponse();
  }

  const email = String(body.email).trim().toLowerCase();
  const password = passCheck.value;

  const lock = isLoginLocked(email);
  if (lock.locked) {
    return withCache(
      NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(lock.retryAfterMs / 1000)),
          },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const emailLimit = rateLimit(`login-email:${email}`, 10, 60 * 60_000);
  if (!emailLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)),
          },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const user = await db.adminUser.findUnique({ where: { email } });

  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH);

  if (!user || !ok) {
    recordLoginFailure(email);

    logger.warn("Failed login attempt", { email: maskEmail(email), ip });
    return loginFailureResponse();
  }

  if (user.role !== "admin") {
    recordLoginFailure(email);
    logger.warn("Non-admin login attempt", {
      email: maskEmail(email),
      ip,
      role: user.role,
    });
    return loginFailureResponse();
  }

  clearLoginFailures(email);

  await createSession(user.id);
  await logActivity({
    userId: user.id,
    action: "login",
    entity: "session",
    summary: `Admin signed in: ${user.email}`,
  });

  return withCache(
    NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    }),
    CACHE_NO_STORE,
  );
});
