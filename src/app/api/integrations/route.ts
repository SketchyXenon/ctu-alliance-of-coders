import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { INTEGRATION_DEFS, toStatus } from "@/lib/integrations";

/**
 * GET /api/integrations - admin only.
 * Returns the full integration catalog merged with stored config + masked
 * secrets. Per 06 section 8: raw secrets are never returned. A DB failure
 * degrades to the catalog with all integrations disabled (02 section 6).
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

  let rows: {
    id: string;
    enabled: boolean;
    config: string | null;
    secret: string | null;
    updatedAt: Date;
  }[] = [];
  try {
    rows = await withDbRetry(() => db.integrationConfig.findMany());
  } catch (e) {
    logger.warn(
      "integrations DB query failed, returning catalog with empty state",
      { error: String(e) },
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items = INTEGRATION_DEFS.map((def) => {
    const row = byId.get(def.id);
    return toStatus(
      row ?? {
        id: def.id,
        enabled: false,
        config: null,
        secret: null,
        updatedAt: null,
      },
      def,
    );
  });

  return withCache(NextResponse.json({ items }), CACHE_NO_STORE);
});
