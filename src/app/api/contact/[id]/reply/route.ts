import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 replies per admin per hour. SMTP is expensive and
  // outbound email is a high-value target for abuse if a session is stolen.
  const rl = rateLimit(`reply:${user.id}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many replies sent recently. Please wait and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate the reply body (the email content).
  const bodyCheck = validateText(body.replyBody, {
    required: true,
    minLen: 5,
    maxLen: MAX_REPLY_BODY,
  });
  if (!bodyCheck.valid) {
    return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
  }

  // Validate the subject (optional; defaults to "Re: <original>").
  const subject = body.subject
    ? String(body.subject).trim().slice(0, MAX_REPLY_SUBJECT)
    : null;

  // Fetch the original message (re-authorize: confirm it exists).
  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
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
    return NextResponse.json(
      { error: result.error || "Failed to send reply email." },
      { status: 502 },
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

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    item: {
      id: updated.id,
      status: updated.status,
    },
  });
});
