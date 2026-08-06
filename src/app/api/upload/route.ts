import { NextResponse } from "next/server";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { withCache, CACHE_NO_STORE } from "@/lib/cache";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import {
  processImageUpload,
  MAX_FILE_SIZE,
  VALID_BUCKETS,
  type UploadBucket,
} from "@/lib/upload";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

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
        { error: "Too many requests. Please slow down." },
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
  if (!file || !(file instanceof File)) {
    return withCache(
      NextResponse.json({ error: "No file provided." }, { status: 400 }),
      CACHE_NO_STORE,
    );
  }

  const bucketRaw = String(formData.get("bucket") ?? "");
  if (!VALID_BUCKETS.includes(bucketRaw as UploadBucket)) {
    return withCache(
      NextResponse.json(
        { error: "Invalid bucket. Must be 'officer' or 'announcement'." },
        { status: 400 },
      ),
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await processImageUpload(buffer, bucketRaw, UPLOAD_ROOT);
  if (!result.ok || !result.url) {
    return withCache(
      NextResponse.json(
        { error: result.error ?? "Upload failed." },
        { status: 400 },
      ),
      CACHE_NO_STORE,
    );
  }

  await logActivity({
    userId: user.id,
    action: "create",
    entity: "upload",
    entityId: result.filename,
    summary: `Uploaded image to ${bucketRaw} bucket (${result.bytes} bytes).`,
  });

  logger.info("Image uploaded", {
    bucket: bucketRaw,
    filename: result.filename,
    bytes: result.bytes,
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
