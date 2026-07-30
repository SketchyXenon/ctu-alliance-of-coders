// Privacy-first page-view analytics server helpers.
//
// Per 06-security-architecture.md:
//   section 8 (data minimization): store a DAILY visitor hash, never raw IP.
//     The hash is SHA-256(ip + day) so a visitor can be counted once per day
//     but not re-identified across days. No cookies, no PII.
//   section 11 (logging): never log raw IP; the visitor hash is the only
//     identifier that reaches the DB or logs.
//   section 5 (validate all external input): path/referrer/device are
//     length-capped + sanitized before storage.
//   section 1 (fail closed): a storage error returns a 204 to the beacon so
//     the user is never blocked by analytics — analytics is best-effort.
//
// Per Z.md: no external analytics SDK. This module + a ~60-line client beacon
// replace Google Analytics / Plausible / Vercel Analytics.

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Max lengths to bound storage and reject abuse (06 section 7). */
const MAX_PATH_LEN = 512;
const MAX_REFERRER_LEN = 200;
const MAX_SESSION_ID_LEN = 64;

/**
 * Hash an IP + day into a non-reversible daily visitor id. The day string is
 * derived from the request timestamp so the hash rotates daily, preventing
 * cross-day tracking. Returns null when the IP is absent or not a valid
 * literal (we never hash "unknown" — it would collapse all anonymous visitors
 * into one bucket).
 */
export function dailyVisitorHash(ip: string | null, dayIso: string): string | null {
  if (!ip || typeof ip !== "string" || ip.length === 0 || ip.length > 45) return null;
  // A per-deploy salt would be stronger, but the goal is NOT unguessability —
  // it is simply preventing raw-IP storage. The hash is never shared or used
  // as an auth token. SHA-256 is fine and vetted (06 section 1: don't build
  // custom crypto; use Node's built-ins).
  return createHash("sha256").update(`${ip}|${dayIso}`).digest("hex");
}

/** Derive a coarse device class from User-Agent. Mobile/tablet/desktop/bot/other.
 *  Coarse on purpose — we don't want a fingerprint, just a rough bucket. */
export function parseDevice(ua: string | null): string {
  if (!ua) return "other";
  const lower = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot/.test(lower)) return "bot";
  if (/tablet|ipad/.test(lower)) return "tablet";
  if (/mobi|android|iphone|ipod/.test(lower)) return "mobile";
  return "desktop";
}

/** Extract the referrer DOMAIN (strip path/query) so no inbound URL params
 *  (which can carry PII) are stored. Returns null for direct visits. */
export function referrerDomain(referrer: string | null | undefined): string | null {
  if (!referrer || typeof referrer !== "string") return null;
  try {
    const url = new URL(referrer);
    // Only keep the registrable host (strip port). Keep it short.
    const host = url.hostname.replace(/^www\./, "");
    return host.slice(0, MAX_REFERRER_LEN) || null;
  } catch {
    return null;
  }
}

/** Sanitize + length-cap a path. Rejects anything that isn't a path-shaped
 *  string (defends against storing arbitrary payloads). */
export function sanitizePath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  // Strip to a reasonable length and drop control chars.
  const cleaned = path.replace(/[\x00-\x1f\x7f]/g, "").slice(0, MAX_PATH_LEN);
  // Must start with "/" to be a real path; otherwise ignore.
  if (!cleaned.startsWith("/")) return null;
  return cleaned;
}

/** Get the visitor's ISO country code from the edge gateway headers. Caddy /
 *  Vercel / Cloudflare set these. Null when no header is present. */
export function countryFromHeaders(headers: Headers): string | null {
  // Vercel: x-vercel-ip-country. Cloudflare: cf-ipcountry. Caddy sets nothing
  // by default, so dev returns null — that's fine (dev analytics is cosmetic).
  const raw =
    headers.get("x-vercel-ip-country") ||
    headers.get("cf-ipcountry") ||
    headers.get("x-country-code");
  if (!raw) return null;
  // ISO-3166 alpha-2 codes are 2 letters. Be strict — don't store junk.
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export interface IngestPayload {
  path: string;
  referrer?: string | null;
  sessionId?: string | null;
}

/**
 * Ingest a single page view. Best-effort: never throws to the caller — a
 * storage failure is logged and swallowed so analytics never breaks the user
 * experience. Per 05-ui-ux-design.md section 6 (non-blocking feedback) +
 * 06 section 1 (fail closed, but analytics is not a gate).
 *
 * Returns true on success, false on failure.
 */
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
    // Analytics must never break the site. Log + swallow (06 section 11).
    logger.warn("page-view ingest failed", { error: String(err).slice(0, 120) });
    return false;
  }
}
