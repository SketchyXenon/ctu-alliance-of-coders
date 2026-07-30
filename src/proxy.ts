import { NextResponse, type NextRequest } from "next/server";
import { generateRequestId, runWithContext, logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security";

// Next.js 16 renamed the "middleware" file convention to "proxy".
// This file was src/middleware.ts; renamed to src/proxy.ts per the deprecation.
// See https://nextjs.org/docs/messages/middleware-to-proxy

// CSRF origin allowlist. Env-driven so staging/preview URLs can be added
// without a code change (S9). Falls back to localhost for dev.
const PROD_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const EXTRA_ORIGINS = (process.env.CSRF_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set<string>([
  PROD_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...EXTRA_ORIGINS,
]);

// Allowed image hosts for CSP img-src. Defaults to self + Supabase storage.
// Supabase uses both .co and .in TLDs (src/lib/db.ts matches both); list both
// so a prod deploy on the .in host doesn't get its images blocked by CSP.
// Add more via IMG_ALLOWED_HOSTS env var (comma-separated hosts).
const DEFAULT_IMG_HOSTS = ["https://*.supabase.co", "https://*.supabase.in"];
const EXTRA_IMG_HOSTS = (process.env.IMG_ALLOWED_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Build the full security-header set applied to EVERY response (including the
 * CSRF-blocked 403). Centralized so the blocked path can't drift from the
 * allowed path (06 section 9: every response carries the headers).
 *
 * Headers applied (per 06-security-architecture.md section 9):
 *  - X-Content-Type-Options: nosniff            (MIME sniffing)
 *  - X-Frame-Options: DENY                       (clickjacking; belt to CSP frame-ancestors)
 *  - Referrer-Policy: strict-origin-when-cross-origin
 *  - Permissions-Policy                          (lock down powerful APIs)
 *  - Strict-Transport-Security (prod only, HTTPS)
 *  - Cross-Origin-Opener-Policy: same-origin     (COOP — isolate browsing context)
 *  - Cross-Origin-Resource-Policy: same-origin   (CORP — block cross-origin reads)
 *  - Cross-Origin-Embedder-Policy: require-corp  (COEP — full cross-origin isolation.
 *                                                  Safe now that the Cloudflare
 *                                                  Turnstile iframe is gone; hardens
 *                                                  against Spectre-style side channels
 *                                                  via SharedArrayBuffer. Per 06 §9.)
 *  - X-DNS-Prefetch-Control: off                 (no DNS prefetch info leak)
 *  - Content-Security-Policy                     (strict, see buildCsp)
 */
function applySecurityHeaders(res: NextResponse, isDev: boolean): void {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  // Full cross-origin isolation (COOP+COEP=require-corp). Now safe since the
  // Cloudflare Turnstile iframe (which needed unsafe-none to load its
  // cross-origin subresources) has been removed. Hardens against Spectre-style
  // side channels. Per 06 section 9.
  res.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  res.headers.set("Content-Security-Policy", buildCsp(isDev));
}

/**
 * Build the Content-Security-Policy. Per 06 section 9: strict default-src,
 * explicit per-directive allowlists. No third-party script/frame/connect hosts
 * are needed now that Cloudflare Turnstile is removed (bot protection is
 * handled by Vercel Firewall at the edge).
 *
 * img-src is restricted to self + explicit allowlist (S7) rather than the
 * overly-permissive "https:" which enabled tracking pixels / cache timing.
 * script-src allows 'unsafe-inline' (Next.js inline runtime) but NOT
 * 'unsafe-eval' in prod. Dev keeps 'unsafe-eval' for HMR.
 */
function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'unsafe-inline'`;
  const imgSrc = [
    "img-src 'self' data: blob:",
    ...DEFAULT_IMG_HOSTS,
    ...EXTRA_IMG_HOSTS,
  ].join(" ");
  return [
    "default-src 'self'",
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    imgSrc,
    `connect-src 'self'`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Proxy (formerly middleware) - security headers, CSRF protection, request ID.
 * Per 06-security-architecture.md: defense in depth, fail closed, zero trust.
 */
export function proxy(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request.headers);
  const isDev = process.env.NODE_ENV !== "production";

  return runWithContext({ requestId, ip }, () => {
    // CSRF protection for state-changing requests. Runs BEFORE building the
    // success response so a blocked request never does app work. Per 06 §5.
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "OPTIONS"
    ) {
      const origin = request.headers.get("origin");
      const secFetchSite = request.headers.get("sec-fetch-site");

      // Allow ONLY same-origin requests (Sec-Fetch-Site: same-origin) or
      // requests whose Origin is on the allowlist. The previous `none`
      // allowance (for user-typed navigations) is dropped: a state-changing
      // POST from a user-typed URL still needs a valid Origin, and a
      // non-browser client can forge `sec-fetch-site: none` (the audit's
      // info finding). SameSite=Lax on the session cookie is the primary
      // CSRF defense; this is defense-in-depth. Per 06 section 5.
      const isAllowed =
        secFetchSite === "same-origin" ||
        (origin !== null && ALLOWED_ORIGINS.has(origin));

      if (!isAllowed) {
        logger.warn("CSRF check failed", {
          method: request.method,
          path: request.nextUrl.pathname,
          origin,
          secFetchSite,
        });
        // Apply the SAME security headers to the blocked response (06 §9:
        // every response carries the headers — the old code built a bare
        // NextResponse that skipped CSP/HSTS/COOP/CORP). Add Cache-Control
        // no-store so the 403 is never cached by an intermediary.
        const blocked = new NextResponse(
          JSON.stringify({ error: "Cross-origin request blocked." }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
        applySecurityHeaders(blocked, isDev);
        blocked.headers.set(
          "Cache-Control",
          "no-store, no-cache, must-revalidate",
        );
        blocked.headers.set("X-Request-Id", requestId);
        return blocked;
      }
    }

    const response = NextResponse.next();
    applySecurityHeaders(response, isDev);
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
