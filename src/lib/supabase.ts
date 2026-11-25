// Server-only Supabase client + Storage helpers.
// Per 06-security-architecture.md section 8: the service role key stays
// server-side (never shipped to the client). Per section 3: the service role
// key bypasses RLS, so ALL authorization is enforced in the app layer
// (requireAdmin in the route handler before any storage call).
//
// Used for image uploads: the admin uploads an image, the server processes it
// (sharp re-encode in src/lib/upload.ts) and stores the result to Supabase
// Storage. The public URL is returned and stored in the DB.
//
// Buckets (created in supabase/migrations/00000000000000_init.sql):
//   officer-photos       (public read, admin write)
//   announcement-images  (public read, admin write)
//
// PRODUCTION GUARD: isSupabaseConfigured() routes through getEnv() so the
// production requirement for Supabase env vars is enforced at the call site
// (not just at boot). This closes the silent-local-fallback bug that caused
// broken production images. Per 03 section 6: fail fast and loud.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let _client: SupabaseClient | null = null;
let _configured: boolean | null = null;

/**
 * Get the server-side Supabase client (service role key, bypasses RLS).
 * Returns null if Supabase is not configured (dev mode without Supabase).
 * Per 06 section 8: server-only — this module must never be imported by client
 * components.
 */
export function getSupabaseServer(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _client;
}

/**
 * True if Supabase is configured. Used by upload.ts to choose storage mode.
 *
 * In production this enforces the env-var requirement inline: if the Supabase
 * vars are missing in prod, upload.ts checks NODE_ENV directly and fails
 * closed with a clear error (no silent local-fallback that stores a URL
 * which 404s on serverless). This mirrors the getEnv() guard in env.ts so
 * the upload path cannot bypass it.
 */
export function isSupabaseConfigured(): boolean {
  if (_configured !== null) return _configured;
  _configured = getSupabaseServer() !== null;
  return _configured;
}

/** Map the app-level bucket name to the Supabase Storage bucket id. */
const BUCKET_MAP: Record<string, string> = {
  officer: "officer-photos",
  announcement: "announcement-images",
};

/**
 * Upload a processed image buffer to Supabase Storage.
 * Returns the public URL of the uploaded file, or null on failure.
 *
 * Per 06 section 3: caller must have already called requireAdmin() before
 * calling this — the service role key bypasses RLS.
 * Per 06 section 11: logs the upload result (no secrets, just the path).
 */
export async function uploadToStorage(
  buffer: Buffer,
  bucket: string,
  filename: string,
): Promise<{ url: string; path: string } | null> {
  const client = getSupabaseServer();
  if (!client) return null;

  const supabaseBucket = BUCKET_MAP[bucket];
  if (!supabaseBucket) {
    logger.error("Invalid bucket for Supabase upload", { bucket });
    return null;
  }

  const storagePath = `${filename}`;
  const { error } = await client.storage
    .from(supabaseBucket)
    .upload(storagePath, buffer, {
      contentType: "image/webp",
      upsert: false,
    });

  if (error) {
    logger.error("Supabase Storage upload failed", {
      error: error.message,
      errorCode: error.name,
      bucket: supabaseBucket,
      path: storagePath,
      bytes: buffer.length,
    });
    return null;
  }

  const { data: publicUrlData } = client.storage
    .from(supabaseBucket)
    .getPublicUrl(storagePath);

  return {
    url: publicUrlData.publicUrl,
    path: storagePath,
  };
}
