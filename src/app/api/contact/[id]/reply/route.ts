import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { sendReplyEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/security";

const MAX_REPLY_BODY = 4000;
const MAX_REPLY_SUBJECT = 200;

/**
 * POST /api/contact/[id]/reply - admin only, sends a reply email to the
 * message submitter via SMTP.
 *
 * Security per 06-security-architecture.md:
 *   - requireAdmin (section 3: re-authorize every object access)
 *   - rate limited per admin user (section 7: rate limit expensive operations)
 *   - input validated via validateText (section 5: validate all external input)
 *   - SMTP credentials stay server-side (section 8: secrets in env, not client)
 *   - audit logged (section 11: log security-relevant events)
 *
 * Reliability per 02-system-design.md:
 *   - withPrismaError wraps the handler (section 6: graceful degradation)
 *   - SMTP has connection + socket timeouts (section 6: no unbounded waits)
 *   - sends plain text only (no HTML XSS surface)
 */
export const POST = withPrismaError(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  // Rate limit: 10 replies per admin per hour. SMTP is expensive and
  // outbound email is a high-value target for abuse if a session is stolen.
  const rl = rateLimit(`reply:${user.id}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many replies sent recently. Please wait and try again." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  // Validate the reply body (the email content).
  const bodyCheck = validateText(body.replyBody, {
    required: true,
    minLen: 5,
    maxLen: MAX_REPLY_BODY,
  });
  if (!bodyCheck.valid) {
    return withCache(
      NextResponse.json({ error: bodyCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  // Validate the subject (optional; defaults to "Re: <original>").
  // Per A05-2: run through validateText (XSS blocklist) even though the
  // subject becomes an email header — defense-in-depth against header
  // injection via nodemailer's Subject field.
  // Per A06 fix: rejectCRLF — CR/LF in a header field enables header
  // injection (CWE-93). Nodemailer typically sanitizes, but we reject
  // early so the admin gets a clear 400 rather than a silently-mangled email.
  let subject: string | null = null;
  if (body.subject) {
    const subjectCheck = validateText(body.subject, {
      maxLen: MAX_REPLY_SUBJECT,
      rejectCRLF: true,
    });
    if (!subjectCheck.valid) {
      return withCache(
        NextResponse.json({ error: subjectCheck.error }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    subject = String(body.subject).trim();
  }

  // Fetch the original message (re-authorize: confirm it exists).
  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return withCache(
      NextResponse.json({ error: "Message not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  const replySubject = subject || `Re: ${existing.subject}`;
  const replyBody = String(body.replyBody).trim();

  // Send the email via SMTP.
  const result = await sendReplyEmail({
    to: existing.email,
    toName: existing.name,
    subject: replySubject,
    body: replyBody,
    originalMessage: existing.message,
    originalSubject: existing.subject,
    originalDate: formatDateTime(existing.createdAt.toISOString()),
    adminEmail: user.email,
  });

  if (!result.ok) {
    // SMTP failed. Do NOT mark the message as resolved. Return the error
    // so the admin can see what went wrong. Per 03 section 6: fail loud.
    return withCache(
      NextResponse.json(
        { error: result.error || "Failed to send reply email." },
        { status: 502 },
      ),
      CACHE_NO_STORE,
    );
  }

  // Email sent successfully. Update the message status to "resolved" so
  // the inbox reflects that it's been handled.
  const updated = await db.contactMessage.update({
    where: { id },
    data: { status: "resolved" },
  });

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "message",
    entityId: id,
    summary: `Replied to message "${existing.subject}" from ${existing.email}`,
  });

  return withCache(
    NextResponse.json({
      ok: true,
      messageId: result.messageId,
      item: {
        id: updated.id,
        status: updated.status,
      },
    }),
    CACHE_NO_STORE,
  );
});
