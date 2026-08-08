import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import {
  validateInviteToken,
  redeemInvite,
  INVITE_TOKEN_BYTES,
} from "@/lib/invites";
import { rateLimit, getClientIp, validateText } from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";

const GENERIC_FAIL = "This invite link is invalid or has expired.";

export const POST = withPrismaError(async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const ipLimit = rateLimit(`invite-redeem-ip:${ip}`, 5, 60 * 60_000);
  if (!ipLimit.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)),
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
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const nameRaw = typeof body.name === "string" ? body.name : null;
  const password = typeof body.password === "string" ? body.password : "";

  if (
    !token ||
    token.length !== INVITE_TOKEN_BYTES * 2 ||
    !/^[0-9a-f]+$/i.test(token)
  ) {
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const validation = await validateInviteToken(token);
  if (!validation.valid || !validation.invite) {
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const passCheck = validatePassword(password, { minLen: 8, maxLen: 128 });
  if (!passCheck.valid || !passCheck.value) {
    return withCache(
      NextResponse.json(
        { error: passCheck.error ?? "Password is required." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  let name: string | null = null;
  if (nameRaw) {
    const nameCheck = validateText(nameRaw, { maxLen: 100, rejectCRLF: true });
    if (!nameCheck.valid) {
      return withCache(
        NextResponse.json({ error: "Name is too long." }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    name = nameRaw.trim();
  }

  const passwordHash = await hashPassword(passCheck.value);
  const result = await redeemInvite(token, name, passwordHash);
  if (!result.ok || !result.userId) {
    if (
      result.reason === "already_redeemed" ||
      result.reason === "email_taken" ||
      result.reason === "used"
    ) {
      return withCache(
        NextResponse.json({ error: GENERIC_FAIL }, { status: 400 }),
        CACHE_NO_STORE,
      );
    }
    return withCache(
      NextResponse.json({ error: GENERIC_FAIL }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  await logActivity({
    userId: result.userId,
    action: "redeem",
    entity: "admin_invite",
    summary: `Admin account created via invite redemption`,
  });
  logger.info("Admin invite redeemed", { userId: result.userId });

  return withCache(
    NextResponse.json({
      ok: true,
      email: result.email,
      message:
        "Account created. You can now sign in with your email and password.",
    }),
    CACHE_NO_STORE,
  );
});
