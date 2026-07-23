import { cookies } from "next/headers";
import { db } from "./db";
import { generateToken } from "./security";
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { logger } from "./logger";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "aoc_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
const MAX_SESSIONS_PER_USER = 5;

/** Hash a password with a per-user salt using async scrypt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

/** Verify a password against a stored salt:hash string. Constant-time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const candidate = await scrypt(password, salt, 64);
    const candidateHash = Buffer.from(hash, "hex");
    if (candidate.length !== candidateHash.length) return false;
    return timingSafeEqual(candidate, candidateHash);
  } catch {
    return false;
  }
}

/** Create a new session for a user, enforcing a max-sessions cap.
 *  Wrapped in a transaction to close the TOCTOU race where two concurrent
 *  logins could each see < cap and each create a session (M2 fix). */
export async function createSession(userId: string): Promise<string> {
  const sessionId = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.$transaction(async (tx) => {
    const existing = await tx.adminSession.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (existing.length >= MAX_SESSIONS_PER_USER) {
      const toDelete = existing.slice(0, existing.length - MAX_SESSIONS_PER_USER + 1);
      await tx.adminSession.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      });
    }

    await tx.adminSession.create({
      data: { id: sessionId, userId, expiresAt },
    });
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return sessionId;
}

/** Destroy the current session (logout). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    try {
      await db.adminSession.deleteMany({ where: { id: sessionId } });
    } catch (e) {
      logger.error("Failed to delete session", { error: String(e) });
    }
    store.delete(SESSION_COOKIE);
  }
}

/** Destroy all sessions for a user except the current one. */
export async function destroyOtherSessions(userId: string, currentSessionId: string): Promise<void> {
  try {
    await db.adminSession.deleteMany({
      where: { userId, NOT: { id: currentSessionId } },
    });
  } catch (e) {
    logger.error("Failed to revoke other sessions", { error: String(e), userId });
  }
}

/** Rotate the current session ID (for privilege changes). Preserves expiry. */
export async function rotateSession(currentSessionId: string): Promise<void> {
  const newId = generateToken(32);
  try {
    // Fetch existing session to preserve expiresAt.
    const existing = await db.adminSession.findUnique({
      where: { id: currentSessionId },
      select: { expiresAt: true },
    });
    if (!existing) {
      logger.error("Session not found during rotation", { sessionId: currentSessionId });
      return;
    }
    await db.adminSession.update({
      where: { id: currentSessionId },
      data: { id: newId },
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, newId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: existing.expiresAt,
    });
  } catch (e) {
    logger.error("Failed to rotate session", { error: String(e) });
    throw e;
  }
}

/** Get the currently authenticated admin user, or null. */
export async function getCurrentUser() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const session = await db.adminSession.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Don't swallow silently - log so expired-session cleanup failures are
    // visible (03-software-engineering.md section 6).
    try {
      await db.adminSession.delete({ where: { id: sessionId } });
    } catch (e) {
      logger.warn("Failed to delete expired session", { error: String(e) });
    }
    return null;
  }
  return session.user;
}

/** Require an authenticated admin; throws a 401-shaped error if absent. */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    const error = new Error("Unauthorized");
    (error as Error & { status: number }).status = 401;
    throw error;
  }
  return user;
}
