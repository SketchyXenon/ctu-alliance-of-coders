import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "./db";
import { logger } from "./logger";
import { sendSecurityEmail } from "./email";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const MFA_CODE_LENGTH = 6;
export const MFA_TTL_MS = 5 * 60_000;
export const MFA_MAX_ATTEMPTS = 5;
export const MFA_RESEND_COOLDOWN_MS = 30_000;

export function generateOtpCode(): string {
  const max = 1_000_000;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= Math.floor(0xffffffff / max) * max);
  const code = value % max;
  return code.toString().padStart(MFA_CODE_LENGTH, "0");
}

export async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(code, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyCode(
  code: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const candidate = await scrypt(code, salt, 64);
    const candidateHash = Buffer.from(hash, "hex");
    if (candidate.length !== candidateHash.length) return false;
    return timingSafeEqual(candidate, candidateHash);
  } catch {
    return false;
  }
}

export interface MfaChallengeResult {
  challengeId: string;
  code: string;
  delivered: boolean;
}

export async function createMfaChallenge(
  userId: string,
  email: string,
): Promise<MfaChallengeResult> {
  const code = generateOtpCode();
  const codeHash = await hashCode(code);
  const expiresAt = new Date(Date.now() + MFA_TTL_MS);

  await db.adminMfaChallenge.deleteMany({
    where: { userId, consumed: false },
  });

  const challenge = await db.adminMfaChallenge.create({
    data: { userId, codeHash, expiresAt },
  });

  const delivered = await deliverMfaCode(email, code);
  return { challengeId: challenge.id, code, delivered };
}

async function deliverMfaCode(email: string, code: string): Promise<boolean> {
  const subject = "Your admin sign-in code";
  const text = [
    `Your admin verification code is: ${code}`,
    "",
    "This code expires in 5 minutes.",
    "If you did not attempt to sign in, ignore this email and change your password.",
  ].join("\n");

  const result = await sendSecurityEmail(email, subject, text);
  if (!result.ok && process.env.NODE_ENV !== "production") {
    logger.warn("MFA code email delivery failed; printing code for dev", {
      email: email[0] + "***" + email.slice(email.indexOf("@")),
      error: result.error,
      devCode: code,
    });
  }
  return result.ok;
}

export interface MfaVerifyResult {
  ok: boolean;
  userId?: string;
  reason?:
    | "not_found"
    | "expired"
    | "consumed"
    | "too_many_attempts"
    | "wrong_code";
  locked?: boolean;
  retryAfterMs?: number;
}

export async function verifyMfaChallenge(
  challengeId: string,
  code: string,
): Promise<MfaVerifyResult> {
  const challenge = await db.adminMfaChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      attempts: true,
      consumed: true,
      expiresAt: true,
    },
  });
  if (!challenge) return { ok: false, reason: "not_found" };
  if (challenge.consumed) return { ok: false, reason: "consumed" };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: "too_many_attempts",
      locked: true,
      retryAfterMs: MFA_TTL_MS,
    };
  }

  const valid = await verifyCode(code, challenge.codeHash);

  if (!valid) {
    const updated = await db.adminMfaChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (updated.attempts >= MFA_MAX_ATTEMPTS) {
      return {
        ok: false,
        reason: "too_many_attempts",
        locked: true,
        retryAfterMs: MFA_TTL_MS,
      };
    }
    return { ok: false, reason: "wrong_code" };
  }

  await db.adminMfaChallenge.update({
    where: { id: challengeId },
    data: { consumed: true },
  });

  return { ok: true, userId: challenge.userId };
}
