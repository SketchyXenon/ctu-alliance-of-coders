import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/security";

// Health check endpoint. Reading request.headers (for rate-limit keying)
// forces this route dynamic, so it is never statically cached. The
// Cache-Control: no-store header keeps the client view fresh.

/**
 * GET /api/health - liveness + readiness probe.
 * Rate-limited per IP to prevent DoS via repeated DB pings (M7 fix).
 */
export async function GET(request: Request) {
  // Per-IP rate limit: 60/min is plenty for LB probes, blocks abuse.
  const ip = getClientIp(request.headers);
  const rl = rateLimit(`health:${ip}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { status: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const checks: Record<string, "ok" | "fail"> = {
    app: "ok",
  };

  // Database connectivity.
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "fail";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  const res = NextResponse.json(
    { status: allOk ? "healthy" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
