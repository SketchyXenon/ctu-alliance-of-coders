// Server-only image upload service.
// Implements the 9-layer upload defense per 06-security-architecture.md:
//   1. Admin-only (enforced in the route handler, not here)
//   2. Rate-limited (enforced in the route handler)
//   3. CSRF check (enforced by proxy.ts)
//   4. Max file size (MAX_FILE_SIZE below)
//   5. Magic-byte detection via file-type (not Content-Type, which is spoofable)
//   6. Allowlist: JPEG / PNG / WebP only
//   7. Sharp re-encode to WebP (strips EXIF metadata + embedded payloads)
//   8. Server-generated filename (crypto.randomUUID, no user input in path)
//   9. Dimension caps (max 2000x2000, resized down — defeats decompression bombs)
//
// Per 06 section 10: "Don't build custom crypto or auth primitives — use
// vetted, maintained libraries." We use file-type (magic bytes) and sharp
// (pixel re-encode) instead of hand-rolled checks.
//
// Per 06 section 1: "Defense in depth — no single control is the only thing
// standing between an attacker and the data." Each layer is independent; an
// attacker who spoofs Content-Type still hits the magic-byte check; an
// attacker who crafts valid magic bytes still hits the sharp re-encode.
//
// Per 06 section 8: "Encrypt data in transit and at rest." Re-encoding to
// WebP also strips GPS coordinates and camera EXIF (privacy: 06 section 8
// "data minimization").

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { uploadToStorage, isSupabaseConfigured } from "./supabase";
import { logger } from "./logger";

// 8MB pre-decode. Sharp's re-encode typically shrinks this 5-10x for photos.
// Per 06 section 7: request/payload size limits prevent DoS via memory exhaustion.
export const MAX_FILE_SIZE = 8 * 1024 * 1024;

// Max dimensions. Larger images are resized down. Per 06 section 7: prevents
// decompression-bomb DoS (a 100x100px PNG that decodes to a 50000x50000 bitmap).
export const MAX_DIMENSION = 2000;

// WebP quality 82 is visually lossless for photos at ~30-50% the size of JPEG.
const WEBP_QUALITY = 82;

export type UploadBucket = "officer" | "announcement";

export const VALID_BUCKETS: UploadBucket[] = ["officer", "announcement"];

export interface UploadResult {
  ok: boolean;
  url?: string;
  filename?: string;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

/**
 * Validate + process an uploaded image file buffer.
 * Returns the saved file's public URL + metadata, or an error.
 *
 * This is the core of the 9-layer defense. The route handler does the
 * auth + rate limit; this function does the file-level validation + transform.
 *
 * Steps:
 *   1. Validate bucket name (path traversal defense).
 *   2. Check file size (DoS defense).
 *   3. Detect actual type via magic bytes (not Content-Type).
 *   4. Reject non-image types (allowlist enforcement).
 *   5. Re-encode with sharp (strips EXIF + embedded payloads).
 *   6. Resize if over MAX_DIMENSION (decompression-bomb defense).
 *   7. Generate server-side filename (no user input in path).
 *   8. Save to Supabase Storage (prod) or local filesystem (dev).
 *   9. Return the public URL.
 */
export async function processImageUpload(
  fileBuffer: Buffer,
  bucket: string,
  uploadRoot: string
): Promise<UploadResult> {
  // Layer 1: validate bucket name. Never trust user input for the path.
  if (!VALID_BUCKETS.includes(bucket as UploadBucket)) {
    return { ok: false, error: "Invalid bucket. Must be 'officer' or 'announcement'." };
  }

  // Layer 2: size check before any processing.
  if (fileBuffer.length === 0) {
    return { ok: false, error: "Empty file." };
  }
  if (fileBuffer.length > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`,
    };
  }

  // Layer 3 + 4: magic-byte detection via file-type. The Content-Type header
  // is client-controlled and spoofable; the magic bytes are not.
  // Per 06 section 5: "Validate and sanitize all external input; never trust
  // it implicitly."
  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected) {
    return { ok: false, error: "Could not detect file type. The file may be corrupt or not a real image." };
  }

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED_MIME.includes(detected.mime)) {
    return {
      ok: false,
      error: `File type ${detected.mime} is not allowed. Only JPEG, PNG, and WebP images are accepted.`,
    };
  }

  // Layer 5 + 6: sharp re-encode to WebP. This is the malware/script defense.
  // Sharp decodes the image to raw pixels, then re-encodes those pixels as
  // WebP. Any non-pixel data (EXIF, PHP payloads, polyglot file appendages,
  // SVG scripts) is dropped — only the pixel array survives the round-trip.
  // Per 06 section 8: also strips GPS/camera metadata (data minimization).
  let pipeline = sharp(fileBuffer, {
    // Fail fast on corrupt input rather than silently producing a broken image.
    failOn: "error",
    // Limit input pixels to prevent decompression-bomb DoS. A 50000x50000
    // bitmap is 10GB in memory. sharp's limit is 268402687 pixels by default;
    // we cap at MAX_DIMENSION^2 = 4,000,000 pixels (2000x2000).
    limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
  });

  // Resize if over MAX_DIMENSION (preserves aspect ratio, fits within bounds).
  pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
    fit: "inside",
    withoutEnlargement: true,
  });

  let processedBuffer: Buffer;
  try {
    processedBuffer = await pipeline
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown sharp error";
    return {
      ok: false,
      error: `Image processing failed: ${msg}. The file may be corrupt or a malicious polyglot.`,
    };
  }

  // Layer 7 + 8: server-generated filename + safe path. Never use the
  // original filename in the storage path (path traversal defense).
  // crypto.randomUUID is collision-resistant and unguessable.
  const filename = `${crypto.randomUUID()}.webp`;

  // Get final dimensions for the response.
  const metadata = await sharp(processedBuffer).metadata();

  // Layer 9: save the processed buffer. In production (Supabase configured),
  // upload to Supabase Storage. In dev (no Supabase), save to the local
  // filesystem. Per 02 section 9 (trade-offs): the local fallback means dev
  // uploads don't persist across serverless instances — acceptable for dev;
  // prod uses Supabase.
  //
  // CRITICAL: in production we MUST NOT fall back to the local filesystem.
  // Vercel's serverless FS is read-only/ephemeral and public/uploads/ is not
  // deployed, so a relative /uploads/... URL stored in the DB would 404 on
  // the live site (broken images). Fail closed with a clear error instead.
  // This is the root-cause fix for broken production images.
  let url: string;
  if (isSupabaseConfigured()) {
    // Production: Supabase Storage.
    const storageResult = await uploadToStorage(processedBuffer, bucket, filename);
    if (!storageResult) {
      return {
        ok: false,
        error: "Failed to upload image to Supabase Storage. Check server logs.",
      };
    }
    url = storageResult.url;
    logger.info("Image uploaded to Supabase Storage", {
      bucket,
      filename,
      bytes: processedBuffer.length,
    });
  } else if (process.env.NODE_ENV === "production") {
    // Production without Supabase configured: refuse rather than store a URL
    // that will 404. Per 03 section 6: fail fast and loud on misconfiguration.
    // Per 06 section 1: fail closed.
    logger.error(
      "Upload rejected: Supabase not configured in production. " +
        "Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      { bucket, filename }
    );
    return {
      ok: false,
      error:
        "Image storage is not configured on the server. " +
        "An administrator must set the Supabase environment variables.",
    };
  } else {
    // Dev only: local filesystem (public/uploads/<bucket>/<filename>).
    const bucketDir = path.join(uploadRoot, bucket);
    const filePath = path.join(bucketDir, filename);

    // Defensive: resolve and confirm the final path is within the upload root.
    // Per 06 section 5: "validate all external input." The bucket is allowlisted
    // and the filename is server-generated, so this is belt-and-suspenders.
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(uploadRoot);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      return { ok: false, error: "Invalid upload path." };
    }

    try {
      await fs.mkdir(bucketDir, { recursive: true });
      await fs.writeFile(filePath, processedBuffer);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown fs error";
      return { ok: false, error: `Failed to save file: ${msg}` };
    }

    // Local URL path (served as a static file from public/uploads/).
    url = `/uploads/${bucket}/${filename}`;
  }

  return {
    ok: true,
    url,
    filename,
    width: metadata.width,
    height: metadata.height,
    bytes: processedBuffer.length,
  };
}
