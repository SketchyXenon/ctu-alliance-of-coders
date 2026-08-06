// Privacy-first page-view analytics server helpers.

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const MAX_PATH_LEN = 512;
const MAX_REFERRER_LEN = 200;
const MAX_SESSION_ID_LEN = 64;


export function dailyVisitorHash(ip: string | null, dayIso: string): string | null {
  if (!ip || typeof ip !== "string" || ip.length === 0 || ip.length > 45) return null;

  return createHash("sha256").update(`${ip}|${dayIso}`).digest("hex");
}

export function parseDevice(ua: string | null): string {
  if (!ua) return "other";
  const lower = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot/.test(lower)) return "bot";
  if (/tablet|ipad/.test(lower)) return "tablet";
  if (/mobi|android|iphone|ipod/.test(lower)) return "mobile";
  return "desktop";
}

export function referrerDomain(referrer: string | null | undefined): string | null {
  if (!referrer || typeof referrer !== "string") return null;
  try {
    const url = new URL(referrer);

    const host = url.hostname.replace(/^www\./, "");
    return host.slice(0, MAX_REFERRER_LEN) || null;
  } catch {
    return null;
  }
}


export function sanitizePath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
 
  const cleaned = path.replace(/[\x00-\x1f\x7f]/g, "").slice(0, MAX_PATH_LEN);

  if (!cleaned.startsWith("/")) return null;
  return cleaned;
}


export function countryFromHeaders(headers: Headers): string | null {

  const raw =
    headers.get("x-vercel-ip-country") ||
    headers.get("cf-ipcountry") ||
    headers.get("x-country-code");
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export interface IngestPayload {
  path: string;
  referrer?: string | null;
  sessionId?: string | null;
}


export async function recordPageView(opts: {
  ip: string | null;
  headers: Headers;
  payload: IngestPayload;
}): Promise<boolean> {
  const { ip, headers, payload } = opts;
  const path = sanitizePath(payload.path);
  if (!path) return false; // nothing useful to record

  const now = new Date();
  const dayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC day)

  try {
    await db.pageView.create({
      data: {
        visitorHash: dailyVisitorHash(ip, dayIso),
        path,
        referrer: referrerDomain(payload.referrer ?? headers.get("referer")),
        device: parseDevice(headers.get("user-agent")),
        country: countryFromHeaders(headers),
        sessionId:
          typeof payload.sessionId === "string" && payload.sessionId.length > 0
            ? payload.sessionId.slice(0, MAX_SESSION_ID_LEN)
            : null,
      },
    });
    return true;
  } catch (err) {

    logger.warn("page-view ingest failed", { error: String(err).slice(0, 120) });
    return false;
  }
}
