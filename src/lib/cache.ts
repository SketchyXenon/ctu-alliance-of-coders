import { NextResponse } from "next/server";

// Standardized Cache-Control headers per route class.
// Per 02-system-design.md section 4 (caching): public reads get s-maxage +
// stale-while-revalidate so a CDN serves cached data while revalidating in
// the background; auth/admin/mutation routes MUST be no-store so no
// intermediary ever caches a session-bound or mutating response (S4).
// Per 06-security-architecture.md section 9: every response gets an explicit
// Cache-Control so the default is never "accidentally public".

/** Public read endpoints (announcements list, admin-years list, site-data).
 *  CDN-cached for 60s, revalidate in background for 5min. */
export const CACHE_PUBLIC_READ = "public, s-maxage=60, stale-while-revalidate=300";

/** Short-lived public fallback (when DB was unreachable, return a brief
 *  max-age so the client doesn't hammer the DB on every retry). */
export const CACHE_PUBLIC_FALLBACK = "public, max-age=10";

/** Auth / admin / mutation endpoints. Never cache. */
export const CACHE_NO_STORE = "no-store, no-cache, must-revalidate";

/** Attach a Cache-Control header to a NextResponse. Returns the same response
 *  for chaining. Centralized so a future policy change touches one place
 *  (03 section 1 DRY). */
export function withCache(res: NextResponse, value: string): NextResponse {
  res.headers.set("Cache-Control", value);
  return res;
}
