import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { CACHE_NO_STORE, withCache } from "@/lib/cache";
import { logActivity } from "@/lib/activity";
import {
  processImageUpload,
  MAX_FILE_SIZE,
  type UploadBucket,
} from "@/lib/upload";
import path from "path";

// Dev uploads are served from /uploads/<bucket>/<file> via the public/ dir.
// Per 02 section 9 (trade-offs): local-fallback dev storage does not persist
// across serverless instances; prod uses Supabase Storage (see lib/upload.ts).
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * POST /api/upload - admin only, compresses + stores an image.
 *
 * Wires the 9-layer processImageUpload defense (lib/upload.ts) behind:
 *   1. requireAdmin (layer 1 of the 9-layer defense — auth)
 *   2. rate limit (layer 2 — per-admin upload throttle)
 *   3. CSRF (layer 3 — enforced by proxy.ts on every state-changing request)
 *   4-9. processImageUpload: size, magic bytes, allowlist, sharp re-encode,
 *        server filename, dimension caps (see lib/upload.ts).
 *
 * Per 06-security-architecture.md A10: fail closed, no stack traces to client.
 * Per 03 section 6: validate all external input; reveal what the user needs.
 * Per 06 section 7: the file.size check enforces MAX_FILE_SIZE after parse;
 * huge-body DoS is bounded by the platform (Caddy / Next.js request body limit).
 */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return withCache(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      CACHE_NO_STORE,
    );
  }

  const rl = rateLimit(`upload:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return withCache(
      NextResponse.json(
        { error: "Too many uploads. Please wait a moment." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        },
      ),
      CACHE_NO_STORE,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return withCache(
      NextResponse.json({ error: "Invalid form data." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const file = formData.get("file");
  const bucket = formData.get("bucket");

  if (!(file instanceof File)) {
    return withCache(
      NextResponse.json({ error: "No file provided." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  if (file.size === 0) {
    return withCache(
      NextResponse.json({ error: "Empty file." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return withCache(
      NextResponse.json(
        {
          error: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`,
        },
        { status: 413 },
      ),
      CACHE_NO_STORE,
    );
  }

  if (
    typeof bucket !== "string" ||
    (bucket !== "officer" && bucket !== "announcement")
  ) {
    return withCache(
      NextResponse.json(
        { error: "Invalid bucket. Must be 'officer' or 'announcement'." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await processImageUpload(
    buffer,
    bucket as UploadBucket,
    UPLOAD_ROOT,
  );
  if (!result.ok) {
    // Validation failures (bad magic bytes, corrupt image) are 400, not 500.
    return withCache(
      NextResponse.json({ error: result.error }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "upload",
    entityId: result.filename,
    summary: `Uploaded image to ${bucket} bucket (${result.bytes} bytes)`,
  });

  return withCache(
    NextResponse.json(
      {
        url: result.url,
        filename: result.filename,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      },
      { status: 201 },
    ),
    CACHE_NO_STORE,
  );
});
