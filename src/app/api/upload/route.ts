import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { withPrismaError } from "@/lib/route-helpers";
import { processImageUpload, MAX_FILE_SIZE } from "@/lib/upload";
import { logActivity } from "@/lib/activity";
import path from "path";

// 8MB hard limit enforced by Next.js (rejects oversized bodies before our code
// runs). Set slightly above MAX_FILE_SIZE so our handler can return a friendly
// error instead of Next.js returning a generic 413.
export const maxDuration = 30; // seconds — sharp re-encode is fast but cap it.
export const fetchCache = "force-no-store";

/**
 * POST /api/upload - admin only, uploads an image file.
 *
 * 9-layer defense (per 06-security-architecture.md section 1 "defense in depth"):
 *   1. Admin-only (requireAdmin)
 *   2. Rate-limited (10/min per user)
 *   3. CSRF check (proxy.ts Origin/Sec-Fetch-Site)
 *   4. Max file size (8MB, checked in processImageUpload)
 *   5. Magic-byte detection (file-type, not Content-Type)
 *   6. Allowlist (JPEG/PNG/WebP only)
 *   7. Sharp re-encode to WebP (strips EXIF + embedded payloads)
 *   8. Server-generated filename (crypto.randomUUID)
 *   9. Dimension caps (max 2000x2000, defeats decompression bombs)
 *
 * Stores to public/uploads/<bucket>/ locally. In production, this can be
 * swapped to Supabase Storage by replacing the save function in upload.ts.
 */
export const POST = withPrismaError(async function POST(request: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Layer 2: rate limit. 10 uploads per minute per admin.
  // Per 06 section 7: "tighter limits on computationally expensive routes."
  const rl = rateLimit(`upload:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a minute and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  // Early size check via Content-Length header. Per 06 section 7: reject
  // oversized payloads fast to avoid memory exhaustion. The header is
  // client-set but we re-check the actual file size after parsing.
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_FILE_SIZE + 1024) {
    // Allow 1KB overhead for the multipart form boundary + metadata.
    return NextResponse.json(
      {
        error: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`,
      },
      { status: 413 },
    );
  }

  // Parse multipart form. Next.js handles the streaming.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid form data. Expected multipart/form-data with a file under 8MB.",
      },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const bucket = formData.get("bucket");

  if (!file) {
    return NextResponse.json(
      { error: "No file provided. Use the 'file' field." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Invalid file field. Expected a File." },
      { status: 400 },
    );
  }
  if (!bucket || typeof bucket !== "string") {
    return NextResponse.json(
      { error: "No bucket provided. Use 'officer' or 'announcement'." },
      { status: 400 },
    );
  }

  // Early size check before reading into memory. Per 06 section 7: reject
  // oversized payloads fast to avoid memory exhaustion.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`,
      },
      { status: 413 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }

  // Read the file into a buffer for processing.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Resolve the upload root (public/uploads/). In production this could be
  // a Supabase Storage path; the processImageUpload function is the seam.
  const uploadRoot = path.join(process.cwd(), "public", "uploads");

  const result = await processImageUpload(buffer, bucket, uploadRoot);

  if (!result.ok) {
    // Return the specific error (wrong type, corrupt image, etc.) with a 400.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Audit log the upload. Per 06 section 11: "Log security-relevant events."
  // Per Bug-4: use the correct entity type based on the bucket.
  await logActivity({
    userId: user.id,
    action: "create",
    entity: bucket === "officer" ? "officer" : "announcement",
    entityId: result.filename,
    summary: `Uploaded image to ${bucket} bucket: ${result.filename} (${result.bytes} bytes, ${result.width}x${result.height})`,
  });

  return NextResponse.json(
    {
      url: result.url,
      filename: result.filename,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    },
    { status: 201 },
  );
});
