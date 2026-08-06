// Server-only image upload service.
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { uploadToStorage, isSupabaseConfigured } from "./supabase";
import { logger } from "./logger";

export const MAX_FILE_SIZE = 8 * 1024 * 1024;

export const MAX_DIMENSION = 2000;

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

export async function processImageUpload(
  fileBuffer: Buffer,
  bucket: string,
  uploadRoot: string,
): Promise<UploadResult> {
  if (!VALID_BUCKETS.includes(bucket as UploadBucket)) {
    return {
      ok: false,
      error: "Invalid bucket. Must be 'officer' or 'announcement'.",
    };
  }

  if (fileBuffer.length === 0) {
    return { ok: false, error: "Empty file." };
  }
  if (fileBuffer.length > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`,
    };
  }

  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected) {
    return {
      ok: false,
      error:
        "Could not detect file type. The file may be corrupt or not a real image.",
    };
  }

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED_MIME.includes(detected.mime)) {
    return {
      ok: false,
      error: `File type ${detected.mime} is not allowed. Only JPEG, PNG, and WebP images are accepted.`,
    };
  }

  let pipeline = sharp(fileBuffer, {
    failOn: "error",

    limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
  });

  pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
    fit: "inside",
    withoutEnlargement: true,
  });

  let processedBuffer: Buffer;
  try {
    processedBuffer = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown sharp error";
    return {
      ok: false,
      error: `Image processing failed: ${msg}. The file may be corrupt or a malicious polyglot.`,
    };
  }

  const filename = `${crypto.randomUUID()}.webp`;

  const metadata = await sharp(processedBuffer).metadata();

  let url: string;
  if (isSupabaseConfigured()) {
    const storageResult = await uploadToStorage(
      processedBuffer,
      bucket,
      filename,
    );
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
    logger.error(
      "Upload rejected: Supabase not configured in production. " +
        "Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      { bucket, filename },
    );
    return {
      ok: false,
      error:
        "Image storage is not configured on the server. " +
        "An administrator must set the Supabase environment variables.",
    };
  } else {
    const bucketDir = path.join(uploadRoot, bucket);
    const filePath = path.join(bucketDir, filename);

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
