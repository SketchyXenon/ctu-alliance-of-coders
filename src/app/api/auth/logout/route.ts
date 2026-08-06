import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    const rl = rateLimit(`logout:${user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return withCache(
        NextResponse.json(
          { error: "Too many requests. Please slow down." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
            },
          },
        ),
        CACHE_NO_STORE,
      );
    }
    await logActivity({
      userId: user.id,
      action: "logout",
      entity: "session",
      summary: `Admin signed out: ${user.email}`,
    });
  }
  await destroySession();
  return withCache(NextResponse.json({ ok: true }), CACHE_NO_STORE);
}
