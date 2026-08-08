import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, ROLE_ADMIN } from "@/lib/auth";
import {
  rateLimit,
  getClientIp,
  validateEmail,
  maskEmail,
} from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import {
  createInvite,
  listInvites,
  InviteCapacityError,
  InviteConflictError,
  INVITE_DEFAULT_TTL_DAYS,
  INVITE_MAX_TTL_DAYS,
} from "@/lib/invites";

export const GET = withPrismaError(async function GET(_request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`admin-invites-list:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const items = await listInvites();
  return withCache(
    NextResponse.json({
      items,
      viewerIsSuperAdmin: user.role === "super_admin",
    }),
    CACHE_NO_STORE,
  );
});

export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireSuperAdmin();
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 403) {
      return withCache(
        NextResponse.json(
          { error: "Only super admins can create invite links." },
          { status: 403 },
        ),
        CACHE_NO_STORE,
      );
    }
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const ip = getClientIp(request.headers);

  const adminLimit = rateLimit(
    `admin-invite-create:${user.id}`,
    5,
    60 * 60_000,
  );
  if (!adminLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Invite creation rate limit reached. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(adminLimit.retryAfterMs / 1000)),
          },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const ipLimit = rateLimit(`admin-invite-create-ip:${ip}`, 10, 60 * 60_000);
  if (!ipLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
          },
        },
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

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.valid || typeof body.email !== "string") {
    return withCache(
      NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }
  const email = body.email.trim().toLowerCase();

  let ttlDays = INVITE_DEFAULT_TTL_DAYS;
  if (typeof body.ttlDays === "number" && Number.isFinite(body.ttlDays)) {
    ttlDays = Math.max(
      1,
      Math.min(Math.floor(body.ttlDays), INVITE_MAX_TTL_DAYS),
    );
  }

  try {
    const result = await createInvite(user.id, email, ROLE_ADMIN, ttlDays);
    await logActivity({
      userId: user.id,
      action: "create",
      entity: "admin_invite",
      entityId: result.invite.id,
      summary: `Created admin invite for ${maskEmail(result.invite.email)} (ttl: ${ttlDays}d)`,
    });
    return withCache(
      NextResponse.json(result, { status: 201 }),
      CACHE_NO_STORE,
    );
  } catch (e) {
    if (e instanceof InviteCapacityError) {
      return withCache(
        NextResponse.json({ error: e.message }, { status: 409 }),
        CACHE_NO_STORE,
      );
    }
    if (e instanceof InviteConflictError && e.code === "email_already_admin") {
      return withCache(
        NextResponse.json(
          { error: "That email is already an admin account." },
          { status: 409 },
        ),
        CACHE_NO_STORE,
      );
    }
    logger.error("Invite creation failed", { error: String(e) });
    return withCache(
      NextResponse.json({ error: "Failed to create invite." }, { status: 500 }),
      CACHE_NO_STORE,
    );
  }
});
