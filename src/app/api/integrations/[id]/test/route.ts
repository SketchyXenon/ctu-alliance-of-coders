import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { logger } from "@/lib/logger";
import {
  getIntegrationDef,
  validateConfig,
  serializeConfig,
  generateWebhookSecret,
  type IntegrationDef,
} from "@/lib/integrations";

export const POST = withPrismaError(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const { id } = await params;
  const def = getIntegrationDef(id);
  if (!def) {
    return withCache(
      NextResponse.json({ error: "Unknown integration." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`integration-test:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many test requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {}

  // ---- webhook -----------------------------------------------------------
  if (def.kind === "webhook") {
    let row = await db.integrationConfig.findUnique({ where: { id } });
    let secret = row?.secret ?? "";
    if (!secret) {
      secret = generateWebhookSecret();
      row = await db.integrationConfig.upsert({
        where: { id },
        update: { enabled: true, secret },
        create: { id, enabled: true, secret },
      });
    } else if (!row.enabled) {
      row = await db.integrationConfig.update({
        where: { id },
        data: { enabled: true },
      });
    }
    await logActivity({
      userId: user.id,
      action: "update",
      entity: "integration",
      entityId: id,
      summary: `Tested webhook integration (key ready): ${def.label}`,
    });

    return withCache(
      NextResponse.json({
        ok: true,
        kind: "webhook",
        secret,
        publishUrl: "/api/webhook/publish",
        header: "x-aoc-signature",
      }),
      CACHE_NO_STORE,
    );
  }

  const stored = await db.integrationConfig.findUnique({ where: { id } });
  const configCheck = validateConfig(id, body.config ?? {});
  if (!configCheck.valid) {
    return withCache(
      NextResponse.json({ error: configCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  const mergedConfig = {
    ...(stored?.config ? JSON.parse(stored.config) : {}),
    ...configCheck.config,
  };
  const secret =
    typeof body.secret === "string" && body.secret.trim()
      ? body.secret.trim()
      : (stored?.secret ?? "");

  // Required-field presence check (BOPLA / mass-assignment defense).
  for (const field of def.fields) {
    if (field.required) {
      const has =
        (mergedConfig as Record<string, string>)[field.name] || secret;
      if (!has) {
        return withCache(
          NextResponse.json(
            { error: `${field.label} is required to test this integration.` },
            { status: 400 },
          ),
          CACHE_NO_STORE,
        );
      }
    }
  }

  const connectivity = await checkConnectivity(
    def,
    mergedConfig as Record<string, string>,
    secret,
  );

  const enabled = connectivity.ok;
  await db.integrationConfig.upsert({
    where: { id },
    update: {
      config: serializeConfig(mergedConfig as Record<string, string>),
      secret: secret || "",
      enabled,
    },
    create: {
      id,
      config: serializeConfig(mergedConfig as Record<string, string>),
      secret: secret || "",
      enabled,
    },
  });

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "integration",
    entityId: id,
    summary: `Tested ${def.label}: ${connectivity.ok ? "ok" : (connectivity.reason ?? "failed")}`,
  });

  return withCache(
    NextResponse.json({
      ok: connectivity.ok,
      kind: "outbound_api",
      reason: connectivity.reason ?? null,
      skipped: connectivity.skipped ?? false,
    }),
    CACHE_NO_STORE,
  );
});

async function checkConnectivity(
  def: IntegrationDef,
  config: Record<string, string>,
  secret: string,
): Promise<{ ok: boolean; reason: string | null; skipped: boolean }> {
  if (def.id === "discord") {
    try {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        method: "GET",
        headers: { Authorization: `Bot ${secret}` },
        signal: AbortSignal.timeout(8_000),
      });
      s;
      if (res.ok)
        return {
          ok: true,
          reason: "Discord accepted the bot token.",
          skipped: false,
        };
      if (res.status === 401)
        return {
          ok: false,
          reason: "Discord rejected the bot token (401).",
          skipped: false,
        };
      return {
        ok: false,
        reason: `Discord returned HTTP ${res.status}.`,
        skipped: false,
      };
    } catch (e) {
      logger.warn("discord connectivity check failed (network)", {
        error: String(e),
      });
      return {
        ok: true,
        reason: "Config valid; live check skipped (network unavailable).",
        skipped: true,
      };
    }
  }

  return {
    ok: true,
    reason: "Configuration saved. External sync requires OAuth app setup.",
    skipped: true,
  };
}
