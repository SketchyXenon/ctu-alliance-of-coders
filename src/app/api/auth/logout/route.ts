import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

/** POST /api/auth/logout - destroys current session, clears cookie. */
export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await logActivity({
      userId: user.id,
      action: "logout",
      entity: "session",
      summary: `Admin signed out: ${user.email}`,
    });
  }
  await destroySession();
  return NextResponse.json({ ok: true });
}
