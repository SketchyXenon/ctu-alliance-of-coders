import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/** GET /api/auth/session - returns current admin user or null. */
export async function GET() {
  const user = await getCurrentUser();
  const res = user
    ? NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      })
    : NextResponse.json({ user: null });
  // Per-session identity must never be cached by an intermediary (S4).
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}
