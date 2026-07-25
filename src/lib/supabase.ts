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
// Buckets (created in supabase/migrations/20260721000000_init_schema.sql):
//   officer-photos       (public read, admin write)
//   announcement-images  (public read, admin write)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let _client: SupabaseClient | null = null;

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

/** True if Supabase is configured. Used by upload.ts to choose storage mode. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseServer() !== null;
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
      bucket: supabaseBucket,
      path: storagePath,
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

/**
 * Delete a file from Supabase Storage.
 * Used when an officer photo or announcement image is replaced/removed.
 * Per 06 section 11: logs the result (no secrets).
 */
export async function deleteFromStorage(
  bucket: string,
  filename: string,
): Promise<boolean> {
  const client = getSupabaseServer();
  if (!client) return false;

  const supabaseBucket = BUCKET_MAP[bucket];
  if (!supabaseBucket) return false;

  const { error } = await client.storage
    .from(supabaseBucket)
    .remove([filename]);

  if (error) {
    logger.error("Supabase Storage delete failed", {
      error: error.message,
      bucket: supabaseBucket,
      path: filename,
    });
    return false;
  }

  return true;
}

/** Reset the client singleton. Used in tests. */
export function _resetSupabaseForTesting(): void {
  _client = null;
}
