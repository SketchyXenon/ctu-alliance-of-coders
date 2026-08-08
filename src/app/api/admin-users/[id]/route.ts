import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin, ROLE_SUPER_ADMIN } from "@/lib/auth";
import { rateLimit, maskEmail } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

const MANAGE_LIMIT = 20;
const MANAGE_WINDOW_MS = 60_000;

function unauthorized() {
  return withCache(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    CACHE_NO_STORE,
  );
}

function forbidden() {
  return withCache(
    NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    CACHE_NO_STORE,
  );
}

function rateLimited(retryAfterMs: number) {
  return withCache(
    NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      },
    ),
    CACHE_NO_STORE,
  );
}

async function resolveTarget(id: string) {
  return db.adminUser.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
}

export const PATCH = withPrismaError(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    return status === 403 ? forbidden() : unauthorized();
  }

  const rl = rateLimit(
    `admin-user-manage:${actor.id}`,
    MANAGE_LIMIT,
    MANAGE_WINDOW_MS,
  );
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  const { id } = await params;
  if (!id) {
    return withCache(
      NextResponse.json({ error: "Invalid account id." }, { status: 400 }),
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

  if (typeof body.active !== "boolean") {
    return withCache(
      NextResponse.json(
        { error: "Field 'active' (boolean) is required." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const target = await resolveTarget(id);
  if (!target) {
    return withCache(
      NextResponse.json({ error: "Account not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  if (target.id === actor.id) {
    return withCache(
      NextResponse.json(
        { error: "You cannot change your own account status." },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }
  if (target.role === ROLE_SUPER_ADMIN) {
    return withCache(
      NextResponse.json(
        { error: "Super admin accounts cannot be deactivated." },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }
  if (target.active === body.active) {
    return withCache(
      NextResponse.json(
        { error: `Account is already ${body.active ? "active" : "inactive"}.` },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }

  await db.adminUser.update({
    where: { id: target.id },
    data: { active: body.active },
  });

  if (body.active === false) {
    await db.adminSession.deleteMany({ where: { userId: target.id } });
    await db.adminMfaChallenge.deleteMany({ where: { userId: target.id } });
  }

  const action = body.active ? "activate" : "deactivate";
  await logActivity({
    userId: actor.id,
    action: "update",
    entity: "admin_user",
    entityId: target.id,
    summary: `${action === "activate" ? "Activated" : "Deactivated"} admin account: ${maskEmail(target.email)}`,
  });
  logger.info("Admin account status changed", {
    actorId: actor.id,
    targetId: target.id,
    active: body.active,
  });

  return withCache(
    NextResponse.json({ ok: true, id: target.id, active: body.active }),
    CACHE_NO_STORE,
  );
});

export const DELETE = withPrismaError(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    return status === 403 ? forbidden() : unauthorized();
  }

  const rl = rateLimit(
    `admin-user-manage:${actor.id}`,
    MANAGE_LIMIT,
    MANAGE_WINDOW_MS,
  );
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  const { id } = await params;
  if (!id) {
    return withCache(
      NextResponse.json({ error: "Invalid account id." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const target = await resolveTarget(id);
  if (!target) {
    return withCache(
      NextResponse.json({ error: "Account not found." }, { status: 404 }),
      CACHE_NO_STORE,
    );
  }

  if (target.id === actor.id) {
    return withCache(
      NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }
  if (target.role === ROLE_SUPER_ADMIN) {
    return withCache(
      NextResponse.json(
        { error: "Super admin accounts cannot be deleted." },
        { status: 409 },
      ),
      CACHE_NO_STORE,
    );
  }

  await db.$transaction([
    db.adminSession.deleteMany({ where: { userId: target.id } }),
    db.adminMfaChallenge.deleteMany({ where: { userId: target.id } }),
    db.adminUser.delete({ where: { id: target.id } }),
  ]);

  await logActivity({
    userId: actor.id,
    action: "delete",
    entity: "admin_user",
    entityId: target.id,
    summary: `Deleted admin account: ${maskEmail(target.email)}`,
  });
  logger.info("Admin account deleted", {
    actorId: actor.id,
    targetId: target.id,
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});
