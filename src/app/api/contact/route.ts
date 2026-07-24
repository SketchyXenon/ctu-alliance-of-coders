import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db, withDbRetry } from "@/lib/db";
import { requireAdmin, getCurrentUser } from "@/lib/auth";
import {
  validateText,
  validateEmail,
  rateLimit,
  generateToken,
  getClientIp,
} from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { CONTACT_TOPICS } from "@/lib/constants";
import type {
  ContactMessage,
  ContactCategory,
  ContactStatus,
} from "@/lib/types";
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

/** GET /api/contact - admin only, list all messages newest first.
 *  Wrapped in withPrismaError so DB-down returns a clean 503, not a raw 500. */
export const GET = withPrismaError(async function GET() {
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
});

/** POST /api/contact - public submit. Rate-limited per IP and per email. */
export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`contact-ip:${ip}`, 4, 10 * 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many submissions from this address. Please wait a few minutes.",
      },
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

  const nameCheck = validateText(body.name, {
    required: true,
    minLen: 2,
    maxLen: 80,
  });
  if (!nameCheck.valid)
    return NextResponse.json({ error: nameCheck.error }, { status: 400 });

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.valid)
    return NextResponse.json({ error: emailCheck.error }, { status: 400 });

  const subjectCheck = validateText(body.subject, {
    required: true,
    minLen: 3,
    maxLen: 120,
  });
  if (!subjectCheck.valid)
    return NextResponse.json({ error: subjectCheck.error }, { status: 400 });

  const messageCheck = validateText(body.message, {
    required: true,
    minLen: 10,
    maxLen: MAX_MESSAGE,
  });
  if (!messageCheck.valid)
    return NextResponse.json({ error: messageCheck.error }, { status: 400 });

  const category = String(body.category ?? "General Inquiry");
  if (!CONTACT_TOPICS.some((t) => t.value === category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const normalizedEmail = String(body.email).trim().toLowerCase();
  const emailLimit = rateLimit(
    `contact-email:${normalizedEmail}`,
    2,
    30 * 60_000,
  );
  if (!emailLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many submissions from this email. Please wait and try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(emailLimit.retryAfterMs / 1000)),
        },
      },
    );
  }

  const clientId =
    typeof body.clientId === "string" && body.clientId
      ? String(body.clientId).slice(0, 128)
      : generateToken(16);

  // Idempotency: try create, catch P2002 (unique on clientId) -> return existing.
  // H1 fix: never return PII to an anonymous caller, even on a dedup hit.
  // A leaked clientId (log/referrer) would otherwise let an attacker read
  // another submitter's name/email/subject/message. Only an authenticated
  // admin receives the full DTO; anonymous callers get a bare ack.
  //
  // The P2002 check uses duck-typing (error.name + error.code) in addition to
  // instanceof, because bundled serverless builds can resolve @prisma/client to
  // a different module instance than the generated client, breaking instanceof.
  // Non-P2002 errors (including PrismaClientInitializationError) are re-thrown
  // so withPrismaError -> handlePrismaError maps them to a clean 503.
  let created;
  try {
    // withDbRetry: retry on transient connection failures (serverless cold
    // start, Supabase pooler warmup). Per 02 section 6: retries with backoff.
    created = await withDbRetry(() =>
      db.contactMessage.create({
        data: {
          clientId,
          name: String(body.name).trim(),
          email: normalizedEmail,
          subject: String(body.subject).trim(),
          category,
          message: String(body.message).trim(),
          status: "new",
        },
      }),
    );
  } catch (error) {
    const isP2002 =
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      ((error as { name?: string })?.name === "PrismaClientKnownRequestError" &&
        (error as { code?: string })?.code === "P2002");
    if (isP2002) {
      const existing = await db.contactMessage.findUnique({
        where: { clientId },
      });
      if (existing) {
        const admin = await getCurrentUser();
        if (admin && admin.role === "admin") {
          return NextResponse.json({
            item: toContactMessageDTO(existing),
            deduplicated: true,
          });
        }
        return NextResponse.json({ ok: true });
      }
    }
    throw error;
  }

  // H1 fix: only return the full DTO to an authenticated admin (the public
  // form does not consume the response body; the admin inbox does).
  const admin = await getCurrentUser();
  if (admin && admin.role === "admin") {
    return NextResponse.json(
      { item: toContactMessageDTO(created) },
      { status: 201 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
});
