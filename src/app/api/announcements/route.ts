import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import {
  serializeLinks,
  parseLinks,
  validateAnnouncementLinks,
} from "@/lib/announcements";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import type { Announcement, AnnouncementType } from "@/lib/types";
import { ANNOUNCEMENT_TYPES } from "@/lib/constants";

const MAX_BODY = 5000;

export async function GET() {
  try {
    const rows = await withDbRetry(() =>
      db.announcement.findMany({
        orderBy: [{ pinned: "desc" }, { date: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
    );
    const items: Announcement[] = rows.map((r) => ({
      id: r.id,
      type: r.type as AnnouncementType,
      title: r.title,
      body: r.body,
      image: r.image,
      links: parseLinks(r.links),
      pinned: r.pinned,
      date: r.date,
    }));
    const res = NextResponse.json({ items });
    res.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return res;
  } catch (e) {
    logger.warn("announcements DB query failed, returning empty list", {
      error: String(e),
    });
    const res = NextResponse.json({ items: [] });
    res.headers.set("Cache-Control", "public, max-age=10");
    return res;
  }
}

/** POST /api/announcements - admin only, create new. */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`ann-create:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
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

  const titleCheck = validateText(body.title, {
    required: true,
    minLen: 5,
    maxLen: 200,
  });
  if (!titleCheck.valid)
    return withCache(
      NextResponse.json({ error: titleCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const bodyCheck = validateText(body.body, {
    required: true,
    minLen: 10,
    maxLen: MAX_BODY,
  });
  if (!bodyCheck.valid)
    return withCache(
      NextResponse.json({ error: bodyCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );

  const type = String(body.type ?? "general");
  if (!ANNOUNCEMENT_TYPES.includes(type as AnnouncementType)) {
    return withCache(
      NextResponse.json(
        { error: "Invalid announcement type." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const imageCheck = validateImageUrl(body.image);
  if (!imageCheck.valid) {
    return withCache(
      NextResponse.json({ error: imageCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const linksCheck = validateAnnouncementLinks(body.links);
  if (!linksCheck.valid) {
    return withCache(
      NextResponse.json({ error: linksCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const id = `ann-${crypto.randomUUID()}`;
  const date = new Date().toISOString().slice(0, 10);
  const created = await db.announcement.create({
    data: {
      id,
      type,
      title: String(body.title).trim(),
      body: String(body.body).trim(),
      image: imageCheck.normalized,
      links: serializeLinks(linksCheck.normalized),
      pinned: typeof body.pinned === "boolean" ? body.pinned : false,
      date,
    },
  });

  const item: Announcement = {
    id: created.id,
    type: created.type as AnnouncementType,
    title: created.title,
    body: created.body,
    image: created.image,
    links: parseLinks(created.links),
    pinned: created.pinned,
    date: created.date,
  };

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "announcement",
    entityId: created.id,
    summary: `Created announcement: ${created.title}`,
  });

  return withCache(
    NextResponse.json({ item }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
