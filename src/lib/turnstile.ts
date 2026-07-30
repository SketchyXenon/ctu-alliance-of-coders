// Cloudflare Turnstile server-side verification + proof-of-work fallback.
//
// Per 06-security-architecture.md:
//   section 1 — fail closed; don't build custom crypto (use vetted libs +
//     Web Crypto for the PoW hash, not a hand-rolled hash).
//   section 2 — secrets stay server-side; the bot-ok cookie is HMAC-signed.
//   section 3 — never trust the client; the cookie is the server-side gate.
//   section 5 — the client token is untrusted until Cloudflare confirms it.
//   section 7 — rate-limit auth-adjacent + expensive endpoints.
//   section 8 — secrets in env, validated at startup.
//
// Per 02-system-design.md section 6: graceful degradation — when Cloudflare
// is unreachable, fall back to a proof-of-work challenge instead of hard-
// blocking legit users (and instead of failing open). The PoW raises the
// cost for bots (CPU-bound) while staying sub-100ms for a real browser.
//
// Per 03-software-engineering.md section 6: fail fast and loud on
// misconfiguration (prod-missing secret -> boot-time error in env.ts).

import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const COOKIE_NAME = "aoc_bot_ok";
/** Cookie lifetime: 2 hours. Long enough to not annoy a browsing user, short
 *  enough that a stale "verified" can't be abused indefinitely. */
export const COOKIE_TTL_MS = 1000 * 60 * 60 * 2;

/** Proof-of-work difficulty: number of leading zero BITS required in the
 *  SHA-256 digest. 16 bits = ~65k attempts avg, ~10-50ms in a browser.
 *  High enough to cost a bot farm real CPU, low enough to not annoy users.
 *  Per 06 section 7: a challenge is a bot-resistance layer, not a crypto
 *  guarantee. */
export const POW_DIFFICULTY_BITS = 16;
/** PoW challenge lifetime: 5 minutes. Short enough to bound replay, long
 *  enough for a slow browser to solve. */
export const POW_CHALLENGE_TTL_MS = 5 * 60_000;
/** Max challenges issued per IP per minute. Prevents challenge flooding. */
const POW_ISSUE_LIMIT = 10;
const POW_ISSUE_WINDOW_MS = 60_000;

export interface TurnstileConfig {
  siteKey: string | null;
  secretKey: string | null;
  /** HMAC key used to sign the bot-ok cookie so it can't be forged client-side. */
  cookieSigningKey: string;
  enabled: boolean;
}

/** Resolve Turnstile config from env. `enabled` is false in dev (no keys). */
export function getTurnstileConfig(): TurnstileConfig {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
  const secretKey = process.env.TURNSTILE_SECRET_KEY || null;
  // The cookie signing key reuses the Turnstile secret if present, else a
  // dev-only fixed value. In prod env.ts fails fast if the secret is missing,
  // so this fallback only ever applies in dev.
  const cookieSigningKey = secretKey || "dev-only-unsigned-bot-cookie-key";
  const enabled = Boolean(siteKey && secretKey);
  return { siteKey, secretKey, cookieSigningKey, enabled };
}

export interface VerifyResult {
  ok: boolean;
  /** Reason for failure (logged server-side, never sent to client verbatim). */
  reason?: string;
  /** True when failure was caused by Cloudflare being unreachable (network/
   *  timeout/5xx). The caller can offer the PoW fallback in this case. */
  serviceDown?: boolean;
  /** True when the failure is RECOVERABLE — a fresh token would likely
   *  succeed. Currently: `timeout-or-duplicate` (the token was consumed or
   *  expired before siteverify ran, e.g. a double-callback or a slow submit).
   *  The caller should reset the widget and let the user re-verify rather
   *  than showing a terminal error. Per 02 §6 (graceful degradation). */
  retryable?: boolean;
  /** True when Turnstile is fundamentally BROKEN on this host — the widget
   *  can't complete clearance redemption (e.g. the site is on Vercel, not a
   *  Cloudflare Zone, so /cdn-cgi/challenge-platform 404s) and produces a
   *  dummy token that siteverify rejects with HTTP 400. This is NOT a
   *  transient error — retrying the widget will fail the same way every time.
   *  The caller should skip retries and go STRAIGHT to the PoW fallback so
   *  the user isn't delayed. Per 02 §6 (graceful degradation) + 06 §1. */
  broken?: boolean;
}

/** Match a single IPv4 or IPv6 literal. Cloudflare's siteverify `remoteip` is
 *  optional but MUST be a valid IP when present — sending a non-IP sentinel
 *  (e.g. "unknown" from getClientIp when no X-Forwarded-For is present) can
 *  make siteverify return `bad-request`, failing EVERY verification and
 *  silently routing users to the PoW fallback. Per 06 §5: validate all
 *  external input before forwarding it to a third party. */
const IP_LITERALS = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]+)$/i;
function isLikelyValidIp(ip: string | null | undefined): ip is string {
  return (
    typeof ip === "string" &&
    ip.length > 0 &&
    ip.length <= 45 &&
    IP_LITERALS.test(ip)
  );
}

/**
 * Verify a Turnstile token server-side by calling Cloudflare's siteverify.
 * Per 06 section 5: the client-supplied token is untrusted until verified.
 *
 * @param token  the Turnstile token from the client widget
 * @param remoteIp  the visitor's IP (forwarded to Cloudflare for analytics)
 * @param config  resolved Turnstile config (so tests can inject a mock)
 * @param fetchImpl  injectable fetch (so tests can mock the Cloudflare call)
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp: string | null,
  config: TurnstileConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  if (!config.enabled) {
    // Dev / unconfigured: skip verification so the app stays usable.
    return { ok: true, reason: "turnstile-disabled" };
  }
  if (
    !token ||
    typeof token !== "string" ||
    token.length < 10 ||
    token.length > 4096
  ) {
    return { ok: false, reason: "missing-or-invalid-token" };
  }
  try {
    const body = new URLSearchParams();
    body.append("secret", config.secretKey!);
    body.append("response", token);
    // Only forward remoteip when it is a real IP literal. getClientIp returns
    // "unknown" when no proxy headers are present; sending that to Cloudflare
    // can trigger `bad-request` and fail every verification. remoteip is
    // optional for siteverify, so omitting it is safe.
    if (isLikelyValidIp(remoteIp)) body.append("remoteip", remoteIp);

    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      // No unbounded wait. Per 02 section 6: timeouts on every external call.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Read the body EVEN on non-2xx so we capture Cloudflare's error-codes
      // for diagnostics. The previous code discarded the 400 body entirely,
      // which hid the real reason (the operator saw a generic "siteverify-
      // http-400" with no error-codes). Per 06 §11: log enough context to
      // investigate.
      let codes = "no-error-codes";
      try {
        const errData = (await res.json()) as { "error-codes"?: string[] };
        codes = (errData["error-codes"] || []).join(",") || "no-error-codes";
      } catch {
        // body wasn't JSON — keep the generic code.
      }
      // 5xx from Cloudflare = service degraded (transient). Mark serviceDown
      // so the caller offers the PoW fallback.
      const serviceDown = res.status >= 500;
      // 400 = the request/token was malformed. On Vercel (not a Cloudflare
      // Zone), the widget can't complete clearance redemption
      // (/cdn-cgi/challenge-platform 404s), so it produces a dummy token that
      // siteverify rejects with 400. This is NOT transient — retrying the
      // widget will fail identically every time. Mark `broken` so the client
      // skips retries and goes STRAIGHT to PoW. Per 02 §6 + 06 §1.
      const broken = res.status === 400;
      return {
        ok: false,
        reason: `siteverify-http-${res.status}:${codes}`,
        serviceDown,
        broken,
      };
    }
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success === true) {
      return { ok: true };
    }
    // Surface Cloudflare's error-codes in the reason so the operator can
    // diagnose (invalid-input-secret, timeout-or-duplicate, etc.) instead of
    // every failure looking identical. Per 06 §11: log security-relevant
    // detail with enough context to investigate. The reason stays server-side
    // (never echoed to the client verbatim).
    const codes = (data["error-codes"] || []).join(",") || "no-error-codes";
    // timeout-or-duplicate is RECOVERABLE: the token was valid but got
    // consumed/expired before siteverify ran (double-callback, slow submit,
    // strict-mode double-mount). A fresh token from a widget reset would
    // succeed. Marking it retryable lets the client auto-reset instead of
    // showing a terminal error. Per 02 §6 (graceful degradation).
    const retryable = codes.includes("timeout-or-duplicate");
    return { ok: false, reason: `siteverify-failed:${codes}`, retryable };
  } catch (e) {
    // Network / timeout: fail CLOSED (a bot shouldn't get through because
    // Cloudflare was briefly unreachable), but mark serviceDown so the caller
    // can route to the PoW fallback. Per 06 section 1: fail closed. Per 02
    // section 6: graceful degradation where possible.
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: `siteverify-error:${msg.slice(0, 80)}`,
      serviceDown: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Proof-of-work fallback (used when Turnstile is unreachable).
//
// Per 02 section 6: "Graceful degradation — a partial result beats a hard
// failure where one is possible." A PoW is not as strong as Turnstile's
// browser fingerprinting, but it raises the cost for bots (CPU-bound at
// scale) and keeps the site usable during a Cloudflare outage. The bot-ok
// cookie is issued the same way as the Turnstile path, so downstream
// enforcement is identical.
// ---------------------------------------------------------------------------

interface PowChallengeEntry {
  challenge: string;
  expiresAt: number;
  consumed: boolean;
}
const powStore = new Map<string, PowChallengeEntry>();
const powIssueTimes = new Map<string, number[]>();

/** Sweep stale PoW entries to bound memory (S3-style eviction). */
function sweepPowStore(now: number): void {
  for (const [k, v] of powStore) {
    if (v.expiresAt < now) powStore.delete(k);
  }
}

export interface PowChallenge {
  challenge: string;
  difficulty: number;
  expiresAt: number;
}

/**
 * Issue a single-use PoW challenge. Rate-limited per IP to prevent flooding.
 * Returns null if the IP has exceeded the issue limit (caller -> 429).
 */
export function issuePowChallenge(ip: string | null): PowChallenge | null {
  const now = Date.now();
  sweepPowStore(now);
  const key = ip || "unknown";
  const times = (powIssueTimes.get(key) || []).filter(
    (t) => now - t < POW_ISSUE_WINDOW_MS,
  );
  if (times.length >= POW_ISSUE_LIMIT) return null;
  times.push(now);
  powIssueTimes.set(key, times);

  const challenge = randomBytes(16).toString("hex");
  const expiresAt = now + POW_CHALLENGE_TTL_MS;
  powStore.set(challenge, { challenge, expiresAt, consumed: false });
  return { challenge, difficulty: POW_DIFFICULTY_BITS, expiresAt };
}

/** Check whether a digest hex has the required leading zero bits. */
export function hasPoWPrefix(
  digestHex: string,
  difficultyBits: number,
): boolean {
  const fullBytes = Math.floor(difficultyBits / 8);
  const remBits = difficultyBits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (digestHex[i * 2] !== "0" || digestHex[i * 2 + 1] !== "0") return false;
  }
  if (remBits > 0) {
    const nibble = parseInt(digestHex[fullBytes * 2], 16);
    // Top `remBits` bits must be zero => nibble < (16 >> remBits).
    if (nibble >= 16 >> remBits) return false;
  }
  return true;
}

/**
 * Verify a PoW solution. The client must find a nonce such that
 * SHA-256(challenge + ":" + nonce) starts with `difficulty` zero bits.
 * Single-use: a challenge is consumed on a successful verify.
 *
 * Uses Node's async crypto (not fetch), so no network dependency.
 */
export async function verifyPowSolution(
  challenge: string,
  nonce: string,
  difficulty: number,
): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(challenge)) return false;
  if (!/^[0-9a-z_-]{1,64}$/i.test(nonce)) return false;
  const entry = powStore.get(challenge);
  if (!entry || entry.consumed || entry.expiresAt < Date.now()) return false;
  const { createHash } = await import("crypto");
  const digest = createHash("sha256")
    .update(`${challenge}:${nonce}`)
    .digest("hex");
  if (!hasPoWPrefix(digest, difficulty)) return false;
  entry.consumed = true;
  return true;
}

// ---------------------------------------------------------------------------
// Signed bot-ok cookie (shared by Turnstile + PoW paths).
// ---------------------------------------------------------------------------

/**
 * Sign a bot-ok cookie value. The cookie proves the visitor passed Turnstile
 * (or PoW fallback) within the last COOKIE_TTL_MS. Format: `<expiresAt>.<hmac>`.
 *
 * The HMAC is keyed by the Turnstile secret so a client can't forge it.
 * Per 06 section 8: secrets stay server-side; the cookie value is verifiable
 * but not forgeable.
 */
export function signBotCookie(
  expiresAt: number,
  config: TurnstileConfig,
): string {
  const hmac = createHmac("sha256", config.cookieSigningKey)
    .update(String(expiresAt))
    .digest("hex");
  return `${expiresAt}.${hmac}`;
}

/**
 * Verify a bot-ok cookie value. Returns true only if the signature matches
 * AND the cookie has not expired. Per 06 section 1: fail closed — a malformed
 * or expired cookie is treated as "not verified".
 */
export function verifyBotCookie(
  cookieValue: string | null | undefined,
  config: TurnstileConfig,
): boolean {
  if (!cookieValue || typeof cookieValue !== "string") return false;
  if (!config.enabled) {
    // Dev: any cookie presence is enough (verification was skipped anyway).
    return true;
  }
  const dot = cookieValue.indexOf(".");
  if (dot < 1) return false;
  const expiresStr = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expiresAt = Number(expiresStr);
  if (!Number.isInteger(expiresAt) || expiresAt < Date.now()) return false;
  const expected = signBotCookie(expiresAt, config);
  // Constant-time compare via timingSafeEqual (imported at top of file).
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected.split(".")[1], "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const BOT_COOKIE_NAME = COOKIE_NAME;

/**
 * Require a valid bot-ok cookie. Used by public write endpoints (contact form)
 * to enforce the bot gate server-side, not just client-side. Per 06 section 3:
 * never trust the client — the BotCheckpoint component is client-only, so a
 * bot using curl/requests bypasses it entirely unless the server re-checks.
 *
 * Returns an error NextResponse (403) if the cookie is missing/invalid, or
 * null if the caller may proceed. When Turnstile is disabled (dev), returns
 * null (the gate is advisory in dev).
 *
 * Per 06 section 1: fail closed — a missing or tampered cookie is treated as
 * "not verified", not as "verified".
 */
export async function requireBotOk(): Promise<null | {
  status: number;
  body: { error: string };
}> {
  const config = getTurnstileConfig();
  if (!config.enabled) return null; // dev: gate is advisory
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const cookie = store.get(BOT_COOKIE_NAME)?.value;
  if (verifyBotCookie(cookie, config)) return null;
  return {
    status: 403,
    body: {
      error:
        "Please complete the bot verification challenge before submitting.",
    },
  };
}
