import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit, sanitizeForHeader } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { sendReplyEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/security";

const MAX_REPLY_BODY = 4000;
const MAX_REPLY_SUBJECT = 200;

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

  const existing = await db.contactMessage.findUnique({ where: { id } });
  if (!existing) {
    return withCache(
      NextResponse.json({ error: "Message not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  const safeSubject = sanitizeForHeader(subject || `Re: ${existing.subject}`);
  const safeToName = sanitizeForHeader(existing.name);
  const replyBody = String(body.replyBody).trim();

  const result = await sendReplyEmail({
    to: existing.email,
    toName: safeToName,
    subject: safeSubject,
    body: replyBody,
    originalMessage: existing.message,
    originalSubject: sanitizeForHeader(existing.subject),
    originalDate: formatDateTime(existing.createdAt.toISOString()),
    adminEmail: user.email,
  });

  if (!result.ok) {
    return withCache(
      NextResponse.json(
        { error: result.error || "Failed to send reply email." },
        { status: 502 },
      ),
      CACHE_NO_STORE,
    );
  }

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
