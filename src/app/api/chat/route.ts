import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { logger } from "@/lib/logger";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import {
  getChatbotConfig,
  buildChatContext,
  buildSystemPrompt,
  callChatCompletion,
  sanitizeReply,
  isAbuseRequest,
  REFUSAL_ABUSE,
  CHAT_MAX_TURNS,
  CHAT_HISTORY_TURNS,
  CHAT_MAX_MSG_LEN,
  CHAT_RATE_PER_MIN,
  CHAT_RATE_PER_HOUR,
} from "@/lib/chatbot";

export async function GET() {
  let enabled = false;
  try {
    const cfg = await getChatbotConfig();
    enabled = !!cfg?.enabled;
  } catch (e) {
    logger.warn("chat status probe failed", { error: String(e) });
  }
  return withCache(NextResponse.json({ enabled }), CACHE_NO_STORE);
}

interface ClientMessage {
  role: string;
  content: unknown;
}

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const rlMin = rateLimit(`chat-min:${ip}`, CHAT_RATE_PER_MIN, 60_000);
  if (!rlMin.allowed) {
    return withCache(
      NextResponse.json(
        { error: "You are sending messages too fast. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rlMin.retryAfterMs / 1000)),
          },
        },
      ),
      CACHE_NO_STORE,
    );
  }
  const rlHour = rateLimit(`chat-hour:${ip}`, CHAT_RATE_PER_HOUR, 3_600_000);
  if (!rlHour.allowed) {
    return withCache(
      NextResponse.json(
        {
          error:
            "You have reached the hourly message limit. Please try again later.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rlHour.retryAfterMs / 1000)),
          },
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
      NextResponse.json({ error: "Invalid request." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return withCache(
      NextResponse.json({ error: "Messages are required." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  if (rawMessages.length > CHAT_MAX_TURNS) {
    return withCache(
      NextResponse.json(
        { error: "Conversation is too long. Please start a new chat." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const cleaned: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of rawMessages as ClientMessage[]) {
    if (typeof m !== "object" || m === null) {
      return withCache(
        NextResponse.json({ error: "Invalid message." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    if (m.role !== "user" && m.role !== "assistant") {
      return withCache(
        NextResponse.json({ error: "Invalid message role." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    if (typeof m.content !== "string" || m.content.trim().length === 0) {
      return withCache(
        NextResponse.json(
          { error: "Message content is required." },
          { status: 400 },
        ),
        CACHE_NO_STORE,
      );
    }
    const content = m.content.trim();
    if (content.length > CHAT_MAX_MSG_LEN) {
      return withCache(
        NextResponse.json({ error: "Message is too long." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    cleaned.push({ role: m.role, content });
  }

  const last = cleaned[cleaned.length - 1];
  if (last.role !== "user") {
    return withCache(
      NextResponse.json({ error: "Awaiting a user message." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  let config;
  try {
    config = await getChatbotConfig();
  } catch (e) {
    logger.error("chat: config load failed", { error: String(e) });
    return withCache(
      NextResponse.json(
        { error: "The AI assistant is unavailable right now." },
        { status: 503 },
      ),
      CACHE_NO_STORE,
    );
  }
  if (!config || !config.enabled) {
    return withCache(
      NextResponse.json(
        { error: "The AI assistant is not available right now." },
        { status: 503 },
      ),
      CACHE_NO_STORE,
    );
  }

  if (isAbuseRequest(last.content)) {
    logger.info("chat: abuse request refused", {});
    return withCache(
      NextResponse.json({ reply: REFUSAL_ABUSE }),
      CACHE_NO_STORE,
    );
  }

  let systemPrompt: string;
  try {
    const context = await buildChatContext();
    systemPrompt = buildSystemPrompt(context);
  } catch (e) {
    logger.error("chat: context build failed", { error: String(e) });
    return withCache(
      NextResponse.json(
        { error: "The AI assistant is unavailable right now." },
        { status: 503 },
      ),
      CACHE_NO_STORE,
    );
  }

  // Send the system prompt + the most recent turns (bounded) to the model.
  const history = cleaned.slice(-CHAT_HISTORY_TURNS);
  const llmMessages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
  ];

  const result = await callChatCompletion(config, llmMessages);
  if (!result.ok || !result.reply) {
    const status = result.error?.includes("rate-limiting") ? 503 : 502;
    return withCache(
      NextResponse.json(
        { error: result.error ?? "The AI assistant is unavailable right now." },
        { status },
      ),
      CACHE_NO_STORE,
    );
  }

  const reply = sanitizeReply(result.reply);
  return withCache(NextResponse.json({ reply }), CACHE_NO_STORE);
});
