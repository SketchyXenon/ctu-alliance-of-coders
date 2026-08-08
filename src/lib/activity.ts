import { db } from "./db";
import { logger } from "./logger";

export async function logActivity(params: {
  userId: string;
  action:
    | "create"
    | "update"
    | "delete"
    | "login"
    | "logout"
    | "view"
    | "revoke"
    | "redeem";
  entity:
    | "announcement"
    | "officer"
    | "year"
    | "message"
    | "session"
    | "upload"
    | "integration"
    | "admin_user"
    | "admin_mfa"
    | "admin_invite";
  entityId?: string;
  summary: string;
}): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        summary: params.summary,
      },
    });
  } catch (e) {
    logger.error("Activity log write failed", {
      error: String(e),
      action: params.action,
      entity: params.entity,
      userId: params.userId,
    });
  }
}
