import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS - only use in trusted server contexts (API routes).
 * Returns null if env vars aren't configured (dev without Supabase).
 */
export function getSupabaseServer(): SupabaseClient | null {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Upload a compressed image to Supabase Storage.
 * Returns the public URL or null on failure.
 * Falls back to null if Supabase isn't configured.
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const client = getSupabaseServer();
  if (!client) return null;

  const { error } = await client.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: false });

  if (error) return null;

  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a file from Supabase Storage by path.
 */
export async function deleteFromStorage(
  bucket: string,
  path: string
): Promise<boolean> {
  const client = getSupabaseServer();
  if (!client) return false;

  const { error } = await client.storage.from(bucket).remove([path]);
  return !error;
}
