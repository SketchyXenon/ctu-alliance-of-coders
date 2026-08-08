import { createHash, randomBytes } from "crypto";
import { db } from "./db";

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_DEFAULT_TTL_DAYS = 7;
export const INVITE_MAX_TTL_DAYS = 30;
export const MAX_PENDING_INVITES = 20;
export const ALLOWED_INVITE_ROLES = ["admin"];

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInviteResult {
  invite: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
  };
  token: string;
}

export async function createInvite(
  createdBy: string,
  email: string,
  role: string,
  ttlDays: number,
): Promise<CreateInviteResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const clampedTtl = Math.max(1, Math.min(ttlDays, INVITE_MAX_TTL_DAYS));
  const expiresAt = new Date(Date.now() + clampedTtl * 24 * 60 * 60_000);

  const pendingCount = await db.adminInvite.count({
    where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pendingCount >= MAX_PENDING_INVITES) {
    throw new InviteCapacityError();
  }

  const existingUser = await db.adminUser.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existingUser) {
    throw new InviteConflictError("email_already_admin");
  }

  const token = generateInviteToken();
  const tokenHash = hashToken(token);

  const invite = await db.adminInvite.create({
    data: {
      email: normalizedEmail,
      role,
      tokenHash,
      createdBy,
      expiresAt,
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return {
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    },
    token,
  };
}

export interface InvitePublicView {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdByEmail: string | null;
}

export async function listInvites(): Promise<InvitePublicView[]> {
  const invites = await db.adminInvite.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      usedAt: true,
      revokedAt: true,
      creator: { select: { email: true } },
    },
  });
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    usedAt: i.usedAt?.toISOString() ?? null,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    createdByEmail: i.creator?.email ?? null,
  }));
}

export async function revokeInvite(
  inviteId: string,
  _adminId: string,
): Promise<boolean> {
  const result = await db.adminInvite.updateMany({
    where: { id: inviteId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export interface InviteValidation {
  valid: boolean;
  invite?: {
    id: string;
    email: string;
    role: string;
  };
  reason?: "not_found" | "expired" | "used" | "revoked";
}

export async function validateInviteToken(
  token: string,
): Promise<InviteValidation> {
  if (!token || token.length !== INVITE_TOKEN_BYTES * 2) {
    return { valid: false, reason: "not_found" };
  }
  const tokenHash = hashToken(token);
  const invite = await db.adminInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!invite) return { valid: false, reason: "not_found" };
  if (invite.usedAt) return { valid: false, reason: "used" };
  if (invite.revokedAt) return { valid: false, reason: "revoked" };
  if (invite.expiresAt < new Date()) return { valid: false, reason: "expired" };
  return {
    valid: true,
    invite: { id: invite.id, email: invite.email, role: invite.role },
  };
}

export interface RedeemResult {
  ok: boolean;
  userId?: string;
  email?: string;
  reason?:
    | "not_found"
    | "expired"
    | "used"
    | "revoked"
    | "email_taken"
    | "already_redeemed";
}

export async function redeemInvite(
  token: string,
  name: string | null,
  passwordHash: string,
): Promise<RedeemResult> {
  if (!token || token.length !== INVITE_TOKEN_BYTES * 2) {
    return { ok: false, reason: "not_found" };
  }
  const tokenHash = hashToken(token);

  return db.$transaction(async (tx) => {
    const invite = await tx.adminInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!invite) return { ok: false, reason: "not_found" as const };
    if (invite.usedAt) return { ok: false, reason: "used" as const };
    if (invite.revokedAt) return { ok: false, reason: "revoked" as const };
    if (invite.expiresAt < new Date())
      return { ok: false, reason: "expired" as const };

    const existing = await tx.adminUser.findUnique({
      where: { email: invite.email },
      select: { id: true },
    });
    if (existing) return { ok: false, reason: "email_taken" as const };

    const claim = await tx.adminInvite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) {
      return { ok: false, reason: "already_redeemed" as const };
    }

    const user = await tx.adminUser.create({
      data: {
        email: invite.email,
        name,
        passwordHash,
        role: invite.role,
      },
      select: { id: true, email: true },
    });

    await tx.adminInvite.update({
      where: { id: invite.id },
      data: { usedBy: user.id },
    });

    return { ok: true as const, userId: user.id, email: user.email };
  });
}

export class InviteCapacityError extends Error {
  constructor(message = "Maximum pending invites reached.") {
    super(message);
    this.name = "InviteCapacityError";
  }
}

export class InviteConflictError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "InviteConflictError";
  }
}
