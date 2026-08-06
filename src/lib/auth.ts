import { cookies } from "next/headers";
import { db } from "./db";
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { logger } from "./logger";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
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

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
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

export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.$transaction(async (tx) => {
    const existing = await tx.adminSession.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (existing.length >= MAX_SESSIONS_PER_USER) {
      const toDelete = existing.slice(
        0,
        existing.length - MAX_SESSIONS_PER_USER + 1,
      );
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

export class SessionNotFoundError extends Error {
  constructor(message = "Session not found during rotation.") {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

export async function rotateSession(currentSessionId: string): Promise<void> {
  const newId = crypto.randomUUID();

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.adminSession.findUnique({
      where: { id: currentSessionId },
      select: { expiresAt: true },
    });
    if (!existing) {
      logger.warn("Session not found during rotation", {
        sessionIdPrefix: currentSessionId.slice(0, 8) + "...",
      });
      throw new SessionNotFoundError();
    }
    await tx.adminSession.update({
      where: { id: currentSessionId },
      data: { id: newId },
    });
    return existing;
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, newId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });
}

export async function getCurrentUser() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  let session;
  try {
    session = await db.adminSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
  } catch (e) {
    logger.warn("Session check failed, treating as logged out", {
      error: String(e),
    });
    return null;
  }
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    try {
      await db.adminSession.delete({ where: { id: sessionId } });
    } catch (e) {
      logger.warn("Failed to delete expired session", { error: String(e) });
    }
    return null;
  }
  return session.user;
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    const error = new Error("Unauthorized");
    (error as Error & { status: number }).status = 401;
    throw error;
  }
  return user;
}
