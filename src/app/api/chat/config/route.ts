import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logActivity } from "@/lib/activity";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import {
  getChatbotStatus,
  validateChatbotConfig,
  CHATBOT_CONFIG_ID,
} from "@/lib/chatbot";

function unauthorized() {
  return withCache(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    CACHE_NO_STORE,
  );
}

export const GET = withPrismaError(async function GET() {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return unauthorized();
  }

  const rl = rateLimit(`chat-cfg-get:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  const status = await getChatbotStatus();
  return withCache(NextResponse.json({ config: status }), CACHE_NO_STORE);
});

export const PUT = withPrismaError(async function PUT(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return unauthorized();
  }

  const rl = rateLimit(`chat-cfg-put:${user.id}`, 10, 60_000);
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

  const result = validateChatbotConfig(body);
  if (!result.valid) {
    return withCache(
      NextResponse.json({ error: result.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : false;

  const existing = await db.integrationConfig.findUnique({
    where: { id: CHATBOT_CONFIG_ID },
  });
  const nextSecret = result.apiKey ?? existing?.secret ?? "";
  if (enabled && !nextSecret) {
    return withCache(
      NextResponse.json(
        { error: "An API key is required to enable the assistant." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const configJson = JSON.stringify({
    baseUrl: result.config.baseUrl,
    model: result.config.model,
    maxTokens: result.config.maxTokens,
    temperature: result.config.temperature,
  });

  await db.integrationConfig.upsert({
    where: { id: CHATBOT_CONFIG_ID },
    create: {
      id: CHATBOT_CONFIG_ID,
      enabled,
      config: configJson,
      secret: nextSecret,
    },
    update: {
      enabled,
      config: configJson,
      ...(result.apiKey !== null ? { secret: result.apiKey } : {}),
    },
  });

  await logActivity({
    userId: user.id,
    action: "update",
    entity: "integration",
    entityId: CHATBOT_CONFIG_ID,
    summary: `Updated AI assistant configuration (${enabled ? "enabled" : "disabled"}).`,
  });

  const status = await getChatbotStatus();
  return withCache(NextResponse.json({ config: status }), CACHE_NO_STORE);
});
