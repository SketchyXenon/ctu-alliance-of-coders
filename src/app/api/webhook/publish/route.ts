import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, validateText, getClientIp } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { logger } from "@/lib/logger";
import {
  verifyWebhookSignature,
  isWebhookTimestampFresh,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@/lib/integrations";
import type { Announcement, AnnouncementType } from "@/lib/types";
import { ANNOUNCEMENT_TYPES } from "@/lib/constants";
import { serializeLinks } from "@/lib/announcements";

export const POST = withPrismaError(async function POST(request: Request) {
  // Rate limit BEFORE signature verification so brute-force attempts on the
  // signature are bounded (§7).
  const ip = getClientIp(request.headers);
  const rl = rateLimit(`webhook-publish:${ip}`, 30, 60_000);
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

  const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER) ?? "";
  const timestamp = request.headers.get(WEBHOOK_TIMESTAMP_HEADER) ?? "";
  const rawBody = await request.text();

  if (!signature || !timestamp) {
    return withCache(
      NextResponse.json(
        { error: "Missing signature headers." },
        { status: 401 },
      ),
      CACHE_NO_STORE,
    );
  }
  if (!isWebhookTimestampFresh(timestamp)) {
    return withCache(
      NextResponse.json(
        { error: "Timestamp is stale or invalid (replay protection)." },
        { status: 401 },
      ),
      CACHE_NO_STORE,
    );
  }

  const cfg = await db.integrationConfig.findUnique({
    where: { id: "webhook" },
  });
  if (!cfg?.enabled || !cfg.secret) {
    return withCache(
      NextResponse.json(
        { error: "Webhook integration is not enabled." },
        { status: 401 },
      ),
      CACHE_NO_STORE,
    );
  }

  if (!verifyWebhookSignature(rawBody, timestamp, signature, cfg.secret)) {
    return withCache(
      NextResponse.json({ error: "Invalid signature." }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  // Signature verified — parse + validate the payload (§5: validate all input).
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const titleCheck = validateText(payload.title, {
    required: true,
    minLen: 5,
    maxLen: 200,
  });
  if (!titleCheck.valid) {
    return withCache(
      NextResponse.json({ error: titleCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  const bodyCheck = validateText(payload.body, {
    required: true,
    minLen: 10,
    maxLen: 5000,
  });
  if (!bodyCheck.valid) {
    return withCache(
      NextResponse.json({ error: bodyCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const type = String(payload.type ?? "general");
  if (!ANNOUNCEMENT_TYPES.includes(type as AnnouncementType)) {
    return withCache(
      NextResponse.json(
        { error: "Invalid announcement type." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  // Links: re-validate each {url,label} (http/https only, §5 + §8).
  let linksJson = "[]";
  if (Array.isArray(payload.links)) {
    const links = payload.links
      .filter(
        (l): l is { url: string; label: string } =>
          typeof l === "object" &&
          l !== null &&
          typeof (l as Record<string, unknown>).url === "string" &&
          typeof (l as Record<string, unknown>).label === "string",
      )
      .slice(0, 10)
      .map((l) => {
        try {
          const u = new URL((l as { url: string }).url);
          if (u.protocol !== "http:" && u.protocol !== "https:") return null;
          return {
            url: (l as { url: string }).url,
            label: (l as { label: string }).label,
          };
        } catch {
          return null;
        }
      })
      .filter((l): l is { url: string; label: string } => l !== null);
    linksJson = serializeLinks(links);
  }

  const pinned = typeof payload.pinned === "boolean" ? payload.pinned : false;
  const date =
    typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      ? payload.date
      : new Date().toISOString().slice(0, 10);

  const id = `ann-${crypto.randomUUID()}`;
  const created = await db.announcement.create({
    data: {
      id,
      type,
      title: String(payload.title).trim(),
      body: String(payload.body).trim(),
      image: null,
      links: linksJson,
      pinned,
      date,
    },
  });

  const item: Announcement = {
    id: created.id,
    type: created.type as AnnouncementType,
    title: created.title,
    body: created.body,
    image: created.image,
    links: linksJson ? JSON.parse(linksJson) : [],
    pinned: created.pinned,
    date: created.date,
  };

  // Audit log with a synthetic actor (no admin session for a webhook).
  try {
    await db.activityLog.create({
      data: {
        userId: "webhook",
        action: "create",
        entity: "announcement",
        entityId: created.id,
        summary: `Webhook published announcement: ${created.title}`,
      },
    });
  } catch (e) {
    logger.warn("webhook activity log write failed", { error: String(e) });
  }

  return withCache(
    NextResponse.json({ item }, { status: 201 }),
    CACHE_NO_STORE,
  );
});
