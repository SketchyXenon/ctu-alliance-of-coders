import { NextResponse } from "next/server";

export const CACHE_PUBLIC_READ =
  "public, s-maxage=60, stale-while-revalidate=300";

export const CACHE_PUBLIC_FALLBACK = "public, max-age=10";

export const CACHE_NO_STORE = "no-store, no-cache, must-revalidate";

export function withCache(res: NextResponse, value: string): NextResponse {
  res.headers.set("Cache-Control", value);
  return res;
}
