import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { validateEmail, rateLimit, getClientIp, maskEmail } from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";

// Dummy hash used to keep verification timing uniform for non-existent users
// (mitigates user enumeration via timing). Must use the salt:hash format that
// verifyPassword expects. Uses a 16-byte salt to match the real hashPassword.
const DUMMY_HASH = "deadbeefdeadbeefdeadbeefdeadbeef:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

/** POST /api/auth/login - email + password, sets session cookie. */
export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  // IP rate limit: 5 per minute.
  const ipLimit = rateLimit(`login-ip:${ip}`, 5, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
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
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const email = String(body.email).trim().toLowerCase();
  const password = passCheck.value;

  // Email-keyed rate limit: 10 per hour per email.
  const emailLimit = rateLimit(`login-email:${email}`, 10, 60 * 60_000);
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts for this account. Please try later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)) } }
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
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  // Role check: return same 401 as invalid credentials (no role oracle).
  if (user.role !== "admin") {
    logger.warn("Non-admin login attempt", { email: maskEmail(email), ip, role: user.role });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
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
}
