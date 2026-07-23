import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, getCurrentUser } from "@/lib/auth";
import { validateText, validateEmail, rateLimit, generateToken, getClientIp } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { CONTACT_TOPICS } from "@/lib/constants";
import type { ContactMessage, ContactCategory, ContactStatus } from "@/lib/types";
import type { ContactMessage as PrismaContactMessage } from "@prisma/client";

const MAX_MESSAGE = 2000;

// Q7: extract the DTO mapper that was duplicated 4x in this file.
function toContactMessageDTO(r: PrismaContactMessage): ContactMessage {
  return {
    id: r.id,
    clientId: r.clientId,
    name: r.name,
    email: r.email,
    subject: r.subject,
    category: r.category as ContactCategory,
    message: r.message,
    status: r.status as ContactStatus,
    createdAt: r.createdAt.toISOString(),
  };
}

/** GET /api/contact - admin only, list all messages newest first. */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.contactMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const items: ContactMessage[] = rows.map(toContactMessageDTO);
  const res = NextResponse.json({ items });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

/** POST /api/contact - public submit. Rate-limited per IP and per email. */
export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`contact-ip:${ip}`, 4, 10 * 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many submissions from this address. Please wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const nameCheck = validateText(body.name, { required: true, minLen: 2, maxLen: 80 });
  if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.error }, { status: 400 });

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.valid) return NextResponse.json({ error: emailCheck.error }, { status: 400 });

  const subjectCheck = validateText(body.subject, { required: true, minLen: 3, maxLen: 120 });
  if (!subjectCheck.valid) return NextResponse.json({ error: subjectCheck.error }, { status: 400 });

  const messageCheck = validateText(body.message, { required: true, minLen: 10, maxLen: MAX_MESSAGE });
  if (!messageCheck.valid) return NextResponse.json({ error: messageCheck.error }, { status: 400 });

  const category = String(body.category ?? "General Inquiry");
  if (!CONTACT_TOPICS.some((t) => t.value === category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const normalizedEmail = String(body.email).trim().toLowerCase();
  const emailLimit = rateLimit(`contact-email:${normalizedEmail}`, 2, 30 * 60_000);
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many submissions from this email. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)) } }
    );
  }

  const clientId =
    typeof body.clientId === "string" && body.clientId ? body.clientId : generateToken(16);

  // Idempotency: try create, catch P2002 (unique on clientId) -> return existing.
  // H1 fix: never return PII to an anonymous caller, even on a dedup hit.
  // A leaked clientId (log/referrer) would otherwise let an attacker read
  // another submitter's name/email/subject/message. Only an authenticated
  // admin receives the full DTO; anonymous callers get a bare ack.
  let created;
  try {
    created = await db.contactMessage.create({
      data: {
        clientId,
        name: String(body.name).trim(),
        email: normalizedEmail,
        subject: String(body.subject).trim(),
        category,
        message: String(body.message).trim(),
        status: "new",
      },
    });
  } catch (error) {
    const { Prisma } = await import("@prisma/client");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.contactMessage.findUnique({ where: { clientId } });
      if (existing) {
        const admin = await getCurrentUser();
        if (admin && admin.role === "admin") {
          return NextResponse.json({ item: toContactMessageDTO(existing), deduplicated: true });
        }
        return NextResponse.json({ ok: true, deduplicated: true });
      }
    }
    throw error;
  }

  // H1 fix: only return the full DTO to an authenticated admin (the public
  // form does not consume the response body; the admin inbox does).
  const admin = await getCurrentUser();
  if (admin && admin.role === "admin") {
    return NextResponse.json({ item: toContactMessageDTO(created) }, { status: 201 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
});
