// Cloudflare Turnstile server-side verification.
// Per 06-security-architecture.md section 2 (don't build custom crypto/auth
// primitives — use vetted libraries): we call Cloudflare's siteverify
// endpoint, NOT a hand-rolled check. Per 06 section 5: validate all external
// input — the token from the client is untrusted until Cloudflare confirms it.
//
// Per 05-ui-ux-design.md: the bot checkpoint is shown on the initial page
// load. Once verified, the server sets a signed HttpOnly cookie so a refresh
// does NOT re-challenge the user (the user's request to /api/verify-bot is
// server-validated; subsequent loads read the cookie).
//
// Graceful degradation: when TURNSTILE_SECRET_KEY is unset (dev), verification
// is skipped (returns ok=true) so the app stays usable locally. In prod,
// instrumentation.ts fails fast if the key is missing.

import { createHmac, timingSafeEqual } from "crypto";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const COOKIE_NAME = "aoc_bot_ok";
/** Cookie lifetime: 2 hours. Long enough to not annoy a browsing user, short
 *  enough that a stale "verified" can't be abused indefinitely. */
export const COOKIE_TTL_MS = 1000 * 60 * 60 * 2;

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
  // dev-only fixed value. In prod both keys must be set.
  const cookieSigningKey = secretKey || "dev-only-unsigned-bot-cookie-key";
  const enabled = Boolean(siteKey && secretKey);
  return { siteKey, secretKey, cookieSigningKey, enabled };
}

export interface VerifyResult {
  ok: boolean;
  /** Reason for failure (logged server-side, never sent to client verbatim). */
  reason?: string;
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
  fetchImpl: typeof fetch = fetch
): Promise<VerifyResult> {
  if (!config.enabled) {
    // Dev / unconfigured: skip verification so the app stays usable.
    return { ok: true, reason: "turnstile-disabled" };
  }
  if (!token || typeof token !== "string" || token.length < 10 || token.length > 4096) {
    return { ok: false, reason: "missing-or-invalid-token" };
  }
  try {
    const body = new URLSearchParams();
    body.append("secret", config.secretKey!);
    body.append("response", token);
    if (remoteIp) body.append("remoteip", remoteIp);

    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      // No unbounded wait. Per 02 section 6: timeouts on every external call.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, reason: `siteverify-http-${res.status}` };
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) {
      return { ok: true };
    }
    return { ok: false, reason: `siteverify-failed:${(data["error-codes"] || []).join(",")}` };
  } catch (e) {
    // Network / timeout: fail CLOSED. A bot shouldn't get through because
    // Cloudflare was briefly unreachable. Per 06 section 1: fail closed.
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `siteverify-error:${msg.slice(0, 80)}` };
  }
}

/**
 * Sign a bot-ok cookie value. The cookie proves the visitor passed Turnstile
 * within the last COOKIE_TTL_MS. Format: `<expiresAt>.<hmac>`.
 *
 * The HMAC is keyed by the Turnstile secret so a client can't forge it.
 * Per 06 section 8: secrets stay server-side; the cookie value is verifiable
 * but not forgeable.
 */
export function signBotCookie(expiresAt: number, config: TurnstileConfig): string {
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
export function verifyBotCookie(cookieValue: string | null | undefined, config: TurnstileConfig): boolean {
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
