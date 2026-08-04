-- Alliance of Coders - fix Supabase linter warning: public bucket allows listing.
--
-- LINTER: public_bucket_allows_listing (WARN)
-- https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing
--
-- The broad SELECT policies on storage.objects ("Public can read officer
-- photos" / "Public can read announcement images") allow clients to LIST all
-- files in each bucket via the Storage API, exposing every filename. Public
-- buckets DON'T need a SELECT policy for object URL access — the app uses
-- getPublicUrl() which returns the public CDN URL
-- (https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>),
-- and that path bypasses RLS entirely for public buckets.
--
-- Fix: DROP the two SELECT policies. Direct image URLs continue to load
-- (the buckets are public: true); listing is correctly denied.
--
-- Idempotent. Run in Supabase dashboard > SQL Editor.

drop policy if exists "Public can read officer photos" on storage.objects;
drop policy if exists "Public can read announcement images" on storage.objects;

-- Verify the buckets are still public (they are — set in the init schema).
-- No action needed; this is just a reminder that public: true is what makes
-- the CDN URLs work, NOT the RLS policies.
