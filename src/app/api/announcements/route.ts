import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { validateText, rateLimit } from "@/lib/security";
import { validateImageUrl } from "@/lib/validation";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import type { Announcement, AnnouncementType } from "@/lib/types";
import { ANNOUNCEMENT_TYPES } from "@/lib/constants";

const MAX_BODY = 5000;

/** GET /api/announcements - public read, newest first. Cached for 60s. */
export async function GET() {
  const rows = await db.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const items: Announcement[] = rows.map((r) => ({
    id: r.id,
    type: r.type as AnnouncementType,
    title: r.title,
    body: r.body,
    image: r.image,
    pinned: r.pinned,
    date: r.date,
  }));
  const res = NextResponse.json({ items });
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}

/** POST /api/announcements - admin only, create new. */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`ann-create:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const titleCheck = validateText(body.title, { required: true, minLen: 5, maxLen: 200 });
  if (!titleCheck.valid) return NextResponse.json({ error: titleCheck.error }, { status: 400 });

  const bodyCheck = validateText(body.body, { required: true, minLen: 10, maxLen: MAX_BODY });
  if (!bodyCheck.valid) return NextResponse.json({ error: bodyCheck.error }, { status: 400 });

  const type = String(body.type ?? "general");
  if (!ANNOUNCEMENT_TYPES.includes(type as AnnouncementType)) {
    return NextResponse.json({ error: "Invalid announcement type." }, { status: 400 });
  }

  // Validate image URL (S1): reject javascript:, data:, off-domain http, etc.
  const imageCheck = validateImageUrl(body.image);
  if (!imageCheck.valid) {
    return NextResponse.json({ error: imageCheck.error }, { status: 400 });
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

  return NextResponse.json({ item }, { status: 201 });
});
