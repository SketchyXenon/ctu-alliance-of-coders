import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { recordPageView } from "@/lib/analytics";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * POST /api/track - ingest an anonymous page view.
 *
 * Public endpoint (no auth — it runs on every page load), so per
 * 06-security-architecture.md section 7 it is rate-limited per IP to bound
 * abuse. Per 06 section 8 (data minimization) the server derives the visitor
 * hash + device + country from headers; the client sends only the path,
 * referrer, and an in-memory session id. Per 06 section 1: best-effort —
 * always returns 204 so analytics never blocks the user.
 *
 * The beacon uses navigator.sendBeacon (05-ui-ux-design.md section 6:
 * non-blocking, survives navigation). A 204 with no body is the lightest
 * possible response.
 *
 * CSRF: this route is state-changing (DB write) but accepts only a path
 * string (no auth, no cookies read). The proxy CSRF check still applies
 * (same-origin / allowlisted Origin required). Per 06 section 5.
 */
export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  // Per-IP rate limit: 60 page views / minute is generous for a real browser
  // (even a tab-spammer) but stops a bot from flooding the table. Per 06 §7.
  const limit = rateLimit(`track:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return withCache(
      new NextResponse(null, {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      }),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON: still 204 — analytics is best-effort, never error to client.
    return new NextResponse(null, { status: 204 });
  }

  const path = typeof body.path === "string" ? body.path : null;
  const referrer = typeof body.referrer === "string" ? body.referrer : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!path) {
    // Nothing to record — return 204 so the beacon completes cleanly.
    return new NextResponse(null, { status: 204 });
  }

  // Fire-and-forget the DB write. The response returns immediately so the
  // beacon isn't held open. A failure is logged inside recordPageView.
  void recordPageView({
    ip,
    headers: request.headers,
    payload: { path, referrer, sessionId },
  });

  // 204 No Content: the beacon needs no body. Cache-Control no-store so a CDN
  // never caches a 204 and suppresses subsequent real beacons.
  return withCache(new NextResponse(null, { status: 204 }), CACHE_NO_STORE);
});

// OPTIONS for preflight (the beacon is same-origin, but be permissive).
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
}
