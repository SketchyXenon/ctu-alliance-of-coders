import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import {
  validateEmail,
  rateLimit,
  getClientIp,
  maskEmail,
} from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";

// Dummy hash used to keep verification timing uniform for non-existent users
// (mitigates user enumeration via timing). Must use the salt:hash format that
// verifyPassword expects. Uses a 16-byte salt to match the real hashPassword.
export const DUMMY_HASH =
  "deadbeefdeadbeefdeadbeefdeadbeef:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

// Enumeration-safe failure response: every 401 path returns the exact same
// status + body so an attacker cannot distinguish "no such email" from "wrong
// password" from "non-admin role". Per 06-security-architecture.md §2: login,
// registration, and password-reset flows must return identical responses for
// valid and invalid identifiers. Extracted as a helper (03 §1 DRY) so the
// regression test in tests/login-enumeration.test.ts can pin the shape.
export const LOGIN_FAILURE_MESSAGE = "Invalid email or password.";
export function loginFailureResponse() {
  return NextResponse.json({ error: LOGIN_FAILURE_MESSAGE }, { status: 401 });
}

/** POST /api/auth/login - email + password, sets session cookie.
 *  Wrapped in withPrismaError so DB-down returns a clean 503, not a raw 500. */
export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  // IP rate limit: 5 per minute.
  const ipLimit = rateLimit(`login-ip:${ip}`, 5, 60_000);
  if (!ipLimit.allowed) {
    // Per A06-2: identical message for IP and email rate limits — prevents
    // an attacker from distinguishing which limit was hit.
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const emailCheck = validateEmail(body.email);
  const passCheck = validatePassword(body.password, { minLen: 1, maxLen: 128 });
  if (!emailCheck.valid || !passCheck.valid || !passCheck.value) {
    // Enumeration-safe: same response for invalid format.
    return loginFailureResponse();
  }

  const email = String(body.email).trim().toLowerCase();
  const password = passCheck.value;

  // Email-keyed rate limit: 10 per hour per email.
  const emailLimit = rateLimit(`login-email:${email}`, 10, 60 * 60_000);
  if (!emailLimit.allowed) {
    // Per A06-2: identical message to the IP rate limit.
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)),
        },
      },
    );
  }

  const user = await db.adminUser.findUnique({ where: { email } });

  // Always run a verification to keep timing uniform (mitigate user enumeration).
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH);

  if (!user || !ok) {
    // M5: mask email in warn log; full email stays in the access-controlled
    // audit trail (logActivity) only. Per 06-security-architecture.md section 11.
    logger.warn("Failed login attempt", { email: maskEmail(email), ip });
    return loginFailureResponse();
  }

  // Role check: return same 401 as invalid credentials (no role oracle).
  if (user.role !== "admin") {
    logger.warn("Non-admin login attempt", {
      email: maskEmail(email),
      ip,
      role: user.role,
    });
    return loginFailureResponse();
  }

  await createSession(user.id);
  await logActivity({
    userId: user.id,
    action: "login",
    entity: "session",
    summary: `Admin signed in: ${user.email}`,
  });

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});
