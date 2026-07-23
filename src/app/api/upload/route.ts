import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/security";
import { uploadToStorage } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";
import { isProduction } from "@/lib/env";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// Strict limits - never trust user input.
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB pre-compression
const MAX_DIMENSION = 4000; // max width/height to prevent decompression bombs
const MAX_PIXELS = 24_000_000; // 24MP cap (4000x6000) - sharp fails above ~26MP
const MIN_DIMENSION = 16; // reject tiny/placeholder images
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

// Magic bytes: don't trust Content-Type header.
const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF header
};

const BUCKET_MAP: Record<string, { local: string; supabase: string }> = {
  officer: { local: "officers", supabase: "officer-photos" },
  announcement: { local: "announcements", supabase: "announcement-images" },
};

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/**
 * POST /api/upload - admin only. Compresses and stores an image.
 *
 * Security layers (defense in depth, never trust user input):
 * 1. Admin auth + per-user rate limit
 * 2. FormData field validation (exact field names)
 * 3. File extension check
 * 4. MIME type allowlist
 * 5. File size limit (pre-compression)
 * 6. Magic bytes verification (don't trust Content-Type)
 * 7. Image metadata scan via sharp (dimensions, pixel count)
 * 8. Re-encode through sharp (strips EXIF, metadata, embedded content)
 * 9. Server-generated filename (no user input in path)
 */
export async function POST(request: Request) {
  // 1. Auth + rate limit.
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`image-upload:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // 2. Parse FormData.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  const bucket = String(formData.get("bucket") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // 3. Validate bucket (exact match, not user-controlled path).
  const bucketConfig = BUCKET_MAP[bucket];
  if (!bucketConfig) {
    return NextResponse.json(
      { error: "Invalid bucket." },
      { status: 400 }
    );
  }

  // 4. Validate file name extension (defense in depth).
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: "File extension not allowed. Use JPG, PNG, or WebP." },
      { status: 400 }
    );
  }

  // 5. Validate MIME type (from header).
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "File type not allowed. Use JPG, PNG, or WebP." },
      { status: 400 }
    );
  }

  // 6. Validate file size.
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Image must be under 5 MB." },
      { status: 400 }
    );
  }

  // 7. Read buffer and verify magic bytes (don't trust Content-Type).
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!verifyMagicBytes(buffer, file.type)) {
    logger.warn("Upload rejected: magic bytes mismatch", {
      userId: user.id,
      declaredType: file.type,
      fileSize: file.size,
    });
    return NextResponse.json(
      { error: "File content does not match declared type." },
      { status: 400 }
    );
  }

  // 8. Scan image metadata with sharp - reject decompression bombs.
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    logger.warn("Upload rejected: sharp could not read image", {
      userId: user.id,
      declaredType: file.type,
    });
    return NextResponse.json(
      { error: "Invalid or corrupted image file." },
      { status: 400 }
    );
  }

  if (!metadata.width || !metadata.height) {
    return NextResponse.json(
      { error: "Image has no dimensions." },
      { status: 400 }
    );
  }

  if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    return NextResponse.json(
      { error: `Image too small. Minimum ${MIN_DIMENSION}x${MIN_DIMENSION} pixels.` },
      { status: 400 }
    );
  }

  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    return NextResponse.json(
      { error: `Image too large. Maximum ${MAX_DIMENSION}x${MAX_DIMENSION} pixels.` },
      { status: 400 }
    );
  }

  const pixelCount = metadata.width * metadata.height;
  if (pixelCount > MAX_PIXELS) {
    return NextResponse.json(
      { error: "Image exceeds maximum pixel count." },
      { status: 400 }
    );
  }

  // 9. Re-encode through sharp: strips EXIF/metadata, resizes, converts to WebP.
  let compressed: Buffer;
  try {
    compressed = await sharp(buffer)
      .rotate() // auto-orient based on EXIF
      .resize(1200, 1200, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    logger.error("Image compression failed", { error: String(err), userId: user.id });
    return NextResponse.json(
      { error: "Failed to process image." },
      { status: 500 }
    );
  }

  // 10. Server-generated filename (no user input in path).
  const filename = `${randomUUID()}.webp`;

  // 11. Store in Supabase (prod) or local (dev).
  if (isProduction()) {
    const publicUrl = await uploadToStorage(
      bucketConfig.supabase,
      filename,
      compressed,
      "image/webp"
    );

    if (publicUrl) {
      return NextResponse.json({
        url: publicUrl,
        size: compressed.length,
        originalSize: buffer.length,
      });
    }

    logger.error("Supabase upload failed", { userId: user.id });
    return NextResponse.json(
      { error: "Failed to upload image." },
      { status: 500 }
    );
  }

  // Dev: local filesystem.
  try {
    const dir = path.join(UPLOAD_DIR, bucketConfig.local);
    await fs.mkdir(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, compressed);
  } catch (err) {
    logger.error("Local file write failed", { error: String(err), userId: user.id });
    return NextResponse.json(
      { error: "Failed to save image." },
      { status: 500 }
    );
  }

  const url = `/uploads/${bucketConfig.local}/${filename}`;
  logger.info("Image uploaded", {
    userId: user.id,
    bucket,
    originalSize: buffer.length,
    compressedSize: compressed.length,
  });

  return NextResponse.json({
    url,
    size: compressed.length,
    originalSize: buffer.length,
  });
}

/** Verify file magic bytes match the declared content type. */
function verifyMagicBytes(buffer: Buffer, declaredType: string): boolean {
  const expected = MAGIC_BYTES[declaredType];
  if (!expected) return false;
  if (buffer.length < expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (buffer[i] !== expected[i]) return false;
  }
  // For WebP, also verify "WEBP" at offset 8.
  if (declaredType === "image/webp") {
    const webpSig = Buffer.from("WEBP");
    if (buffer.length < 12 || buffer.slice(8, 12).equals(webpSig) === false) {
      return false;
    }
  }
  return true;
}
