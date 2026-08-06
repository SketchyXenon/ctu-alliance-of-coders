import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { recordPageView } from "@/lib/analytics";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

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
    return new NextResponse(null, { status: 204 });
  }

  const path = typeof body.path === "string" ? body.path : null;
  const referrer = typeof body.referrer === "string" ? body.referrer : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!path) {
    return new NextResponse(null, { status: 204 });
  }
  void recordPageView({
    ip,
    headers: request.headers,
    payload: { path, referrer, sessionId },
  });

  return withCache(new NextResponse(null, { status: 204 }), CACHE_NO_STORE);
});

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
}
