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

// Cloudflare Turnstile hosts. The widget loads its api.js + renders an
// iframe + posts the token to siteverify, so all three CSP directives must
// allow challenges.cloudflare.com. Without this, the bot-checkpoint widget
// is blocked by CSP in prod (06 section 9: security headers must not break
// legitimate functionality).
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

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
 *  - Cross-Origin-Opener-Policy: same-origin     (COOP — isolate browsing context,
 *                                                  blocks cross-origin window references)
 *  - Cross-Origin-Resource-Policy: same-origin   (CORP — block cross-origin reads
 *                                                  of our responses)
 *  - Cross-Origin-Embedder-Policy: credentialless (COEP — blocks no-cors cross-origin
 *                                                  embeds unless they opt in via CORP;
 *                                                  credentialless so Supabase image
 *                                                  loads with cookies still work)
 *  - X-DNS-Prefetch-Control: off                 (no DNS prefetch info leak)
 *  - Content-Security-Policy                     (strict, see buildCsp)
 *
 * COOP+COEP pair enables crossOriginIsolation, which hardens against
 * spectre-style side channels that read cross-origin responses via
 * SharedArrayBuffer + high-resolution timers. COEP=credentialless (not
 * require-corp) so third-party image hosts that don't send CORP headers
 * still load, but without credentials.
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
  // credentialless: blocks no-cors cross-origin embeds unless they opt in via
  // CORP, but allows credentialled subresource loads (Supabase images). Safer
  // than require-corp for this app's image-heavy UI. Per 06 section 9.
  res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
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
 * explicit per-directive allowlists. Turnstile requires:
 *   - script-src  https://challenges.cloudflare.com (api.js)
 *   - frame-src   https://challenges.cloudflare.com (widget iframe)
 *   - connect-src https://challenges.cloudflare.com (token callback fetch)
 *
 * img-src is restricted to self + explicit allowlist (S7) rather than the
 * overly-permissive "https:" which enabled tracking pixels / cache timing.
 * script-src allows 'unsafe-inline' (Next.js inline runtime) but NOT
 * 'unsafe-eval' in prod. Dev keeps 'unsafe-eval' for HMR.
 */
function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${TURNSTILE_HOST}`
    : `script-src 'self' 'unsafe-inline' ${TURNSTILE_HOST}`;
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
    // connect-src: self + Turnstile siteverify endpoint. The client
    // BotCheckpoint POSTs to /api/verify-bot (same-origin), but the Turnstile
    // widget itself calls siteverify from the iframe (frame-src covers that).
    `connect-src 'self' ${TURNSTILE_HOST}`,
    // frame-src: Turnstile widget iframe. Without this, the widget's iframe
    // is blocked by default-src 'self'.
    `frame-src ${TURNSTILE_HOST}`,
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
