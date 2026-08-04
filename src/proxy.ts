import { NextResponse, type NextRequest } from "next/server";
import { generateRequestId, runWithContext, logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security";

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

const DEFAULT_IMG_HOSTS = ["https://*.supabase.co", "https://*.supabase.in"];
const EXTRA_IMG_HOSTS = (process.env.IMG_ALLOWED_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

export function proxy(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request.headers);
  const isDev = process.env.NODE_ENV !== "production";

  return runWithContext({ requestId, ip }, () => {
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "OPTIONS"
    ) {
      const origin = request.headers.get("origin");
      const secFetchSite = request.headers.get("sec-fetch-site");

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
