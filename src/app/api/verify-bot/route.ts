import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientIp, rateLimit } from "@/lib/security";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import {
  getTurnstileConfig,
  verifyTurnstileToken,
  verifyBotCookie,
  signBotCookie,
  issuePowChallenge,
  verifyPowSolution,
  POW_DIFFICULTY_BITS,
  BOT_COOKIE_NAME,
  COOKIE_TTL_MS,
} from "@/lib/turnstile";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * Bot verification endpoints (Cloudflare Turnstile + proof-of-work fallback).
 *
 * Two verification modes:
 *   - "turnstile": the client widget produces a token; the server verifies it
 *     with Cloudflare's siteverify. The strong path.
 *   - "pow": when Turnstile is unreachable (script load failure or siteverify
 *     network/5xx error), the client solves a server-issued hashcash-style
 *     challenge (SHA-256 with a zero-bit prefix). The fallback path.
 *
 * Both paths converge on the same signed HttpOnly bot-ok cookie (aoc_bot_ok,
 * 2h TTL). Downstream public endpoints enforce the cookie via requireBotOk().
 *
 * Per 06 section 1: fail closed. Per 06 section 3: never trust the client.
 * Per 06 section 7: rate-limit auth-adjacent endpoints. Per 02 section 6:
 * graceful degradation — the PoW fallback keeps legit users in during a
 * Cloudflare outage without failing open.
 */

/** POST /api/verify-bot - verify a Turnstile token or PoW solution. */
export const POST = withPrismaError(async function POST(request: Request) {
  const config = getTurnstileConfig();
  const ip = getClientIp(request.headers);

  // Per-IP rate limit on verification attempts (06 section 7). Tighter than
  // generic endpoints because each Turnstile attempt does an outbound fetch
  // to Cloudflare (amplification risk). PoW attempts are CPU-bound here.
  const limit = rateLimit(`verify-bot:${ip}`, 10, 60_000);
  if (!limit.allowed) {
    return withCache(
      NextResponse.json(
        {
          ok: false,
          error: "Too many verification attempts. Please wait a minute.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  // Dev / unconfigured: skip verification, no cookie needed (the client gate
  // also short-circuits). Returning ok=true keeps the contract uniform.
  if (!config.enabled) {
    return withCache(
      NextResponse.json({ ok: true, disabled: true }),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCache(
      NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const mode = typeof body.mode === "string" ? body.mode : "turnstile";

  // --- PoW fallback path ------------------------------------------------
  if (mode === "pow") {
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const ok = await verifyPowSolution(challenge, nonce, POW_DIFFICULTY_BITS);
    if (!ok) {
      logger.warn("PoW verification failed", { ip });
      return withCache(
        NextResponse.json(
          {
            ok: false,
            error: "Proof-of-work invalid or expired. Please retry.",
          },
          { status: 403 },
        ),
        CACHE_NO_STORE,
      );
    }
    return await issueBotOkCookie(config);
  }

  // --- Turnstile path (default) ----------------------------------------
  const token = typeof body.token === "string" ? body.token : null;
  const result = await verifyTurnstileToken(token, ip, config);

  if (!result.ok) {
    logger.warn("Turnstile verification failed", {
      reason: result.reason,
      ip,
      serviceDown: result.serviceDown,
    });
    // If Cloudflare was unreachable, tell the client to fall back to PoW.
    // The client still has to solve a real challenge, so this is not a bypass.
    const payload: Record<string, unknown> = {
      ok: false,
      error: "Bot verification failed. Please try again.",
    };
    if (result.serviceDown) {
      const ch = issuePowChallenge(ip);
      if (ch) {
        payload.fallback = "pow";
        payload.powChallenge = ch;
      } else {
        // IP exceeded the challenge-issue limit.
        payload.error = "Too many challenges. Please wait a minute.";
      }
    }
    return withCache(
      NextResponse.json(payload, { status: 403 }),
      CACHE_NO_STORE,
    );
  }

  return await issueBotOkCookie(config);

  /** Set the signed bot-ok cookie on a successful verification. Shared by
   *  both paths so downstream enforcement is identical. Awaited by the caller
   *  so the cookie is set before the response is returned (was returning a
   *  Promise<NextResponse> without await — latent bug). */
  async function issueBotOkCookie(cfg: typeof config): Promise<NextResponse> {
    const expiresAt = Date.now() + COOKIE_TTL_MS;
    const cookieValue = signBotCookie(expiresAt, cfg);
    // HttpOnly so JS can't read it; SameSite=Lax so it survives top-level
    // navigations; Secure in prod. Per 06 section 2.
    const store = await cookies();
    store.set(BOT_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(expiresAt),
    });
    return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
  }
});

/**
 * GET /api/verify-bot - check whether the caller already has a valid bot-ok
 * cookie. Used by the client gate to decide whether to skip the challenge
 * (so a refresh doesn't re-challenge). Per 06 section 5: the cookie is
 * server-signed, so this check is trustworthy.
 *
 * When not verified AND Turnstile is enabled, the response includes a PoW
 * challenge so the client can pre-fetch it if it needs the fallback (saves a
 * round-trip when Cloudflare is down).
 */
export async function GET() {
  const config = getTurnstileConfig();
  const store = await cookies();
  const cookie = store.get(BOT_COOKIE_NAME)?.value;
  const verified = verifyBotCookie(cookie, config);
  const payload: {
    verified: boolean;
    enabled: boolean;
    powChallenge?: { challenge: string; difficulty: number; expiresAt: number };
  } = {
    verified,
    enabled: config.enabled,
  };
  if (!verified && config.enabled) {
    const ip = getClientIp(new Headers());
    const ch = issuePowChallenge(ip);
    if (ch) payload.powChallenge = ch;
  }
  return withCache(NextResponse.json(payload), CACHE_NO_STORE);
}
