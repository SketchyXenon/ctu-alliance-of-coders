import { NextResponse, type NextRequest } from "next/server";
import { generateRequestId, runWithContext, logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security";

// Next.js 16 renamed the "middleware" file convention to "proxy".
// This file was src/middleware.ts; renamed to src/proxy.ts per the deprecation.
// See https://nextjs.org/docs/messages/middleware-to-proxy

// CSRF origin allowlist. Env-driven so staging/preview URLs can be added
// without a code change (S9). Falls back to localhost + the prod domain.
const PROD_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://allianceofcoders.ph";
const EXTRA_ORIGINS = (process.env.CSRF_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [
  PROD_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...EXTRA_ORIGINS,
];

// Allowed image hosts for CSP img-src. Defaults to self + Supabase storage.
// Add more via IMG_ALLOWED_HOSTS env var (comma-separated hosts).
const DEFAULT_IMG_HOSTS = ["https://*.supabase.co"];
const EXTRA_IMG_HOSTS = (process.env.IMG_ALLOWED_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Proxy (formerly middleware) - security headers, CSRF protection, request ID.
 * Per 06-security-architecture.md: defense in depth, fail closed, zero trust.
 */
export function proxy(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request.headers);

  return runWithContext({ requestId, ip }, () => {
    const response = NextResponse.next();

    // Security headers on all responses.
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // HSTS only in production (HTTPS).
    if (process.env.NODE_ENV === "production") {
      response.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload"
      );
    }

    // CSP: strict script-src (no unsafe-eval in production).
    // img-src is restricted to self + explicit allowlist (S7) rather than the
    // overly-permissive "https:" which enabled tracking pixels / cache timing.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const imgSrc = [
      "img-src 'self' data: blob:",
      ...DEFAULT_IMG_HOSTS,
      ...EXTRA_IMG_HOSTS,
    ].join(" ");
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      imgSrc,
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    response.headers.set("Content-Security-Policy", csp);

    // CSRF protection for state-changing requests.
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      const origin = request.headers.get("origin");
      const secFetchSite = request.headers.get("sec-fetch-site");

      // Allow same-origin requests (Sec-Fetch-Site: same-origin).
      // For cross-origin or missing Sec-Fetch-Site, check Origin allowlist.
      // Note: browsers send sec-fetch-site "none" for user-initiated top-level
      // navigations; non-browser clients (curl, Postman) omit the header.
      const isAllowed =
        secFetchSite === "same-origin" ||
        secFetchSite === "none" ||
        (origin !== null && ALLOWED_ORIGINS.includes(origin));

      if (!isAllowed) {
        logger.warn("CSRF check failed", {
          method: request.method,
          path: request.nextUrl.pathname,
          origin,
          secFetchSite,
        });
        return new NextResponse(JSON.stringify({ error: "Cross-origin request blocked." }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Add request ID to response for client-side correlation.
    response.headers.set("X-Request-Id", requestId);

    return response;
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|logo.svg|background.jpg|uploads).*)",
  ],
};
