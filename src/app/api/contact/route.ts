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
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { CONTACT_TOPICS } from "@/lib/constants";
import type {
  ContactMessage,
  ContactCategory,
  ContactStatus,
} from "@/lib/types";
import type { ContactMessage as PrismaContactMessage } from "@prisma/client";

const MAX_MESSAGE = 2000;

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
    rejectCRLF: true,
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
    rejectCRLF: true,
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

  try {
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

  return withCache(
    NextResponse.json({ ok: true }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
