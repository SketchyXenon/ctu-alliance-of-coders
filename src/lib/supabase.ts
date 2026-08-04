import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

let _client: SupabaseClient | null = null;
let _configured: boolean | null = null;

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

export function isSupabaseConfigured(): boolean {
  if (_configured !== null) return _configured;
  _configured = getSupabaseServer() !== null;
  return _configured;
}

const BUCKET_MAP: Record<string, string> = {
  officer: "officer-photos",
  announcement: "announcement-images",
};

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

/** Reset the client + config cache. Used in tests. */
export function _resetSupabaseForTesting(): void {
  _client = null;
  _configured = null;
}
