import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isSmtpConfigured } from "@/lib/email";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

/**
 * GET /api/integrations/email/status - admin only.
 * Returns whether SMTP is configured (does NOT expose credentials).
 * Per 06 section 8: secrets stay server-side. The response is a boolean.
 */
export const GET = withPrismaError(async function GET() {
  try {
    await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  return withCache(
    NextResponse.json({
      configured: isSmtpConfigured(),
      fromName: process.env.SMTP_FROM_NAME || "Alliance of Coders",
      fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || null,
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    }),
    CACHE_NO_STORE,
  );
});
