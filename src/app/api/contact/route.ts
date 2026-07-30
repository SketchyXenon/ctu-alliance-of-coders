import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db, withDbRetry } from "@/lib/db";
import { requireAdmin, getCurrentUser } from "@/lib/auth";
import type { AdminUser } from "@prisma/client";
import {
  validateText,
  validateEmail,
  rateLimit,
  generateToken,
  getClientIp,
} from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { requireBotOk } from "@/lib/turnstile";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { CONTACT_TOPICS } from "@/lib/constants";
import type {
  ContactMessage,
  ContactCategory,
  ContactStatus,
} from "@/lib/types";
import type { ContactMessage as PrismaContactMessage } from "@prisma/client";

const MAX_MESSAGE = 2000;

// Q7: extract the DTO mapper that was duplicated 4x in this file.
export function toContactMessageDTO(r: PrismaContactMessage): ContactMessage {
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

// H1 regression helper: build the dedup response based on caller role.
// Anonymous callers get a bare {ok:true} ack (no PII). Authenticated admins
// get the full DTO + deduplicated:true flag so the admin inbox can show the
// existing message. Extracted as a helper (03 §1 DRY) so the regression test
// in tests/contact-dedup.test.ts can pin both response shapes.
export function buildDedupResponse(
  existing: PrismaContactMessage,
  admin: Pick<AdminUser, "id" | "role"> | null,
): NextResponse {
  if (admin && admin.role === "admin") {
    return withCache(
      NextResponse.json({
        item: toContactMessageDTO(existing),
        deduplicated: true,
      }),
      CACHE_NO_STORE,
    );
  }
  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
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

/** POST /api/contact - public submit. Rate-limited per IP and per email.
 *  Authenticated admins are rejected (403): the contact form is a public
 *  intake channel, not a self-message path. Admins must log out first.
 *  Defense-in-depth: the client also hides the form for admins, but the
 *  server check is authoritative per 06 section 3 (never trust the client).
 *  Ordering: the IP rate limit runs BEFORE getCurrentUser() so an
 *  unauthenticated attacker can't amplify DB load via the session lookup
 *  (06 section 7: rate limiting first). */
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

  // Server-side bot-gate enforcement. The BotCheckpoint component is client-
  // only, so a bot using curl/requests bypasses it; this re-checks the signed
  // bot-ok cookie. Per 06 section 3: never trust the client. No-op in dev
  // (Turnstile disabled). Runs after the rate limit so cookie-less spam is
  // still bounded by the IP limit.
  const botGate = await requireBotOk();
  if (botGate) {
    return withCache(
      NextResponse.json(botGate.body, { status: botGate.status }),
      CACHE_NO_STORE,
    );
  }

  // Admins are rejected after the rate limit passes (defense in depth).
  const admin = await getCurrentUser();
  if (admin && admin.role === "admin") {
    return withCache(
      NextResponse.json(
        {
          error: "Admins cannot submit contact messages. Please log out first.",
        },
        { status: 403 },
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

  const nameCheck = validateText(body.name, {
    required: true,
    minLen: 2,
    maxLen: 80,
  });
  if (!nameCheck.valid)
    return withCache(
      NextResponse.json({ error: nameCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.valid)
    return withCache(
      NextResponse.json({ error: emailCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const subjectCheck = validateText(body.subject, {
    required: true,
    minLen: 3,
    maxLen: 120,
  });
  if (!subjectCheck.valid)
    return withCache(
      NextResponse.json({ error: subjectCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const messageCheck = validateText(body.message, {
    required: true,
    minLen: 10,
    maxLen: MAX_MESSAGE,
  });
  if (!messageCheck.valid)
    return withCache(
      NextResponse.json({ error: messageCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const category = String(body.category ?? "General Inquiry");
  if (!CONTACT_TOPICS.some((t) => t.value === category)) {
    return withCache(
      NextResponse.json({ error: "Invalid category." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const normalizedEmail = String(body.email).trim().toLowerCase();
  const emailLimit = rateLimit(
    `contact-email:${normalizedEmail}`,
    2,
    30 * 60_000,
  );
  if (!emailLimit.allowed) {
    return withCache(
      NextResponse.json(
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
      ),
      CACHE_NO_STORE,
    );
  }

  // Validate clientId if provided (A01-1 fix: defense-in-depth — run through
  // the XSS blocklist even though clientId isn't rendered in the UI today).
  const clientIdInput =
    typeof body.clientId === "string" && body.clientId
      ? String(body.clientId).slice(0, 128)
      : generateToken(16);
  const clientIdCheck = validateText(clientIdInput, { maxLen: 128 });
  if (!clientIdCheck.valid) {
    return withCache(
      NextResponse.json({ error: clientIdCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  const clientId = clientIdInput;

  // Idempotency: try create, catch P2002 (unique on clientId) -> return existing.
  // H1 fix: never return PII to an anonymous caller, even on a dedup hit.
  // A leaked clientId (log/referrer) would otherwise let an attacker read
  // another submitter's name/email/subject/message. Anonymous callers always
  // get a bare ack here (admins are rejected at the top of POST).
  try {
    // withDbRetry: retry on transient connection failures (serverless cold
    // start, Supabase pooler warmup). Per 02 section 6: retries with backoff.
    await withDbRetry(() =>
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
    // Duck-typed P2002 check (instanceof can fail across module instances in
    // bundled serverless builds). Non-P2002 errors re-throw to withPrismaError.
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
        return buildDedupResponse(existing, admin);
      }
    }
    throw error;
  }

  // Admins are rejected at the top of POST, so the caller here is always
  // anonymous -> bare ack, no PII. (buildDedupResponse stays exported for the
  // dedup path + tests/contact-dedup.test.ts.)
  return withCache(
    NextResponse.json({ ok: true }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
