import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { rateLimit, maskEmail } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { db } from "@/lib/db";
import { revokeInvite } from "@/lib/invites";

export const DELETE = withPrismaError(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireSuperAdmin();
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 403) {
      return withCache(
        NextResponse.json(
          { error: "Only super admins can revoke invite links." },
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

  const rl = rateLimit(`admin-invite-revoke:${user.id}`, 20, 60_000);
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

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return withCache(
      NextResponse.json({ error: "Invalid invite id." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const invite = await db.adminInvite.findUnique({
    where: { id },
    select: { email: true, usedAt: true, revokedAt: true },
  });
  if (!invite) {
    return withCache(
      NextResponse.json({ error: "Invite not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  const revoked = await revokeInvite(id, user.id);
  if (!revoked) {
    return withCache(
      NextResponse.json(
        {
          error:
            "Invite cannot be revoked (already used, expired, or revoked).",
        },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }

  await logActivity({
    userId: user.id,
    action: "revoke",
    entity: "admin_invite",
    entityId: id,
    summary: `Revoked admin invite for ${maskEmail(invite.email)}`,
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});
