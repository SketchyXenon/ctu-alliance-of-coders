import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientIp } from "@/lib/security";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import {
  getTurnstileConfig,
  verifyTurnstileToken,
  verifyBotCookie,
  signBotCookie,
  BOT_COOKIE_NAME,
  COOKIE_TTL_MS,
} from "@/lib/turnstile";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * POST /api/verify-bot - verify a Cloudflare Turnstile token server-side.
 *
 * On success, sets a signed HttpOnly cookie (aoc_bot_ok) so subsequent page
 * loads don't re-challenge the user. Per the feature request: "validated
 * through server-side so that users cannot recursively challenged by the bot
 * after refreshing their web browser."
 *
 * Per 06 section 5: the token is untrusted until Cloudflare confirms it.
 * Per 06 section 8: the cookie is signed with the server-side Turnstile
 * secret, so it can't be forged by a client.
 *
 * Body: { token: string } from the Turnstile widget.
 */
export const POST = withPrismaError(async function POST(request: Request) {
  const config = getTurnstileConfig();
  const ip = getClientIp(request.headers);

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

  const token = typeof body.token === "string" ? body.token : null;
  const result = await verifyTurnstileToken(token, ip, config);

  if (!result.ok) {
    logger.warn("Turnstile verification failed", { reason: result.reason, ip });
    return withCache(
      NextResponse.json(
        { ok: false, error: "Bot verification failed. Please try again." },
        { status: 403 },
      ),
      CACHE_NO_STORE,
    );
  }

  // Success: set the signed bot-ok cookie. HttpOnly so JS can't read it (the
  // server reads it on the next page load to skip the challenge). SameSite=Lax
  // so it survives top-level navigations.
  const expiresAt = Date.now() + COOKIE_TTL_MS;
  const cookieValue = signBotCookie(expiresAt, config);
  const store = await cookies();
  store.set(BOT_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
});

/**
 * GET /api/verify-bot - check whether the caller already has a valid bot-ok
 * cookie. Used by the client gate to decide whether to skip the challenge
 * (so a refresh doesn't re-challenge). Per 06 section 5: the cookie is
 * server-signed, so this check is trustworthy.
 */
export async function GET() {
  const config = getTurnstileConfig();
  const store = await cookies();
  const cookie = store.get(BOT_COOKIE_NAME)?.value;
  const verified = verifyBotCookie(cookie, config);
  return withCache(
    NextResponse.json({ verified, enabled: config.enabled }),
    CACHE_NO_STORE,
  );
}
