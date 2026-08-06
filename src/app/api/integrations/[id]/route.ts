import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import {
  INTEGRATION_IDS,
  getIntegrationDef,
  validateConfig,
  validateSecret,
  serializeConfig,
  parseConfig,
  generateWebhookSecret,
  toStatus,
} from "@/lib/integrations";

export const PUT = withPrismaError(async function PUT(
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

  const rl = rateLimit(`integration-upsert:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  if (enabled === undefined) {
    return withCache(
      NextResponse.json(
        { error: "`enabled` (boolean) is required." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const configInput = body.config === undefined ? {} : body.config;
  const configCheck = validateConfig(id, configInput);
  if (!configCheck.valid) {
    return withCache(
      NextResponse.json({ error: configCheck.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  // Resolve the secret value.
  let secretValue: string | undefined;
  if (def.kind === "webhook") {
    const existing = await db.integrationConfig.findUnique({
      where: { id },
      select: { secret: true },
    });
    if (existing?.secret) {
      secretValue = existing.secret;
    } else {
      secretValue = generateWebhookSecret();
    }
  } else {
    const secretCheck = validateSecret(id, body.secret);
    if (!secretCheck.valid) {
      return withCache(
        NextResponse.json({ error: secretCheck.error }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    secretValue = secretCheck.normalized ?? undefined;
  }

  let storedRow: { secret: string; config: string } | null = null;
  if (def.kind === "outbound_api") {
    storedRow =
      (await db.integrationConfig.findUnique({
        where: { id },
        select: { secret: true, config: true },
      })) ?? null;
  }
  if (enabled && def.kind === "outbound_api") {
    if (!storedRow?.secret && !secretValue) {
      return withCache(
        NextResponse.json(
          {
            error:
              "A secret (credential) is required to enable this integration.",
          },
          { status: 400 },
        ),
        CACHE_NO_STORE,
      );
    }
    const mergedConfig: Record<string, string> = {
      ...(storedRow?.config ? parseConfig(storedRow.config) : {}),
      ...configCheck.config,
    };
    for (const field of def.fields) {
      if (field.required) {
        const has =
          mergedConfig[field.name] || secretValue || storedRow?.secret;
        if (!has) {
          return withCache(
            NextResponse.json(
              {
                error: `${field.label} is required to enable this integration.`,
              },
              { status: 400 },
            ),
            CACHE_NO_STORE,
          );
        }
      }
    }
    if (secretValue === undefined) secretValue = storedRow?.secret ?? "";
  }

  let finalConfig: Record<string, string>;
  if (def.kind === "webhook") {
    finalConfig = {};
  } else {
    finalConfig = {
      ...(storedRow?.config ? parseConfig(storedRow.config) : {}),
      ...configCheck.config,
    };
  }

  const data = {
    enabled,
    config: serializeConfig(finalConfig),
    secret: secretValue ?? storedRow?.secret ?? "",
  };

  const row = await db.integrationConfig.upsert({
    where: { id },
    update: data,
    create: { id, ...data },
  });

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "integration",
    entityId: id,
    summary: `${enabled ? "Enabled" : "Disabled"} integration: ${def.label}`,
  });

  return withCache(
    NextResponse.json({ item: toStatus(row, def) }),
    CACHE_NO_STORE,
  );
});

export const DELETE = withPrismaError(async function DELETE(
  _request: Request,
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
  if (!INTEGRATION_IDS.includes(id)) {
    return withCache(
      NextResponse.json({ error: "Unknown integration." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const row = await db.integrationConfig.upsert({
    where: { id },
    update: { enabled: false, config: "", secret: "" },
    create: { id, enabled: false, config: "", secret: "" },
  });

  await logActivity({
    userId: user.id,
    action: "delete",
    entity: "integration",
    entityId: id,
    summary: `Cleared integration config: ${id}`,
  });

  return withCache(
    NextResponse.json({ item: toStatus(row, getIntegrationDef(id)) }),
    CACHE_NO_STORE,
  );
});

export const POST = withPrismaError(async function POST(
  _request: Request,
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
  if (def.kind !== "webhook") {
    return withCache(
      NextResponse.json(
        { error: "Only webhook integrations support key rotation." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const newSecret = generateWebhookSecret();
  const row = await db.integrationConfig.upsert({
    where: { id },
    update: { enabled: true, secret: newSecret },
    create: { id, enabled: true, secret: newSecret },
  });

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "integration",
    entityId: id,
    summary: `Rotated webhook signing key for: ${def.label}`,
  });

  return withCache(
    NextResponse.json({ item: toStatus(row, def), secret: newSecret }),
    CACHE_NO_STORE,
  );
});
