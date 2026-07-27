import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, validateEmail } from "@/lib/security";
import { sendTestEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * POST /api/integrations/email/test - admin only.
 * Sends a test email to verify SMTP connectivity.
 * Body: { to: "email@example.com" } (optional; defaults to the admin's email).
 *
 * Per 06 section 7: rate limited (5 per hour per admin).
 * Per 06 section 11: audit logged.
 */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`email-test:${user.id}`, 5, 60 * 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        {
          error:
            "Too many test emails sent recently. Please wait and try again.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let to = user.email;
  try {
    const body = await request.json();
    if (body && typeof body.to === "string" && body.to.trim()) {
      const check = validateEmail(body.to);
      if (!check.valid) {
        return withCache(
          NextResponse.json({ error: check.error }, { status: 400 }),
          CACHE_NO_STORE,
        );
      }
      to = String(body.to).trim().toLowerCase();
    }
  } catch {
    // Empty body is fine — default to admin's email.
  }

  const result = await sendTestEmail(to);

  if (!result.ok) {
    return withCache(
      NextResponse.json(
        { error: result.error || "Failed to send test email." },
        { status: 502 },
      ),
      CACHE_NO_STORE,
    );
  }

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "message",
    summary: `Sent SMTP test email to ${to}`,
  });

  return withCache(
    NextResponse.json({ ok: true, messageId: result.messageId, to }),
    CACHE_NO_STORE,
  );
});
