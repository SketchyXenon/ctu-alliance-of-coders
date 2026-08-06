import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  const res = user
    ? NextResponse.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      })
    : NextResponse.json({ user: null });

  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}
