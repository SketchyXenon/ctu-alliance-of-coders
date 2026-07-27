-- Alliance of Coders - drop dead-code profiles infrastructure.
-- Per ADR-0003: the profiles table, handle_new_user trigger, and profile-based
-- RLS policies are dead code. The app uses custom cookie-session auth (ADR-0001)
-- and talks to Supabase only through the service-role key (bypasses RLS).
--
-- This cleanup is required because Prisma db push cannot introspect the
-- database while there is a cross-schema FK (public.profiles -> auth.users).
-- Removing this dead code resolves the P4002 error without touching Supabase's
-- managed auth schema (auth.users, auth.identities, auth.schema_migrations).
--
-- Idempotent: safe to run multiple times. Non-destructive to Supabase Auth.
-- Per 03 section 6: fail safe. Per 06 section 8: data minimization.

-- ── 1. Drop the trigger on auth.users that calls handle_new_user ───────────
-- This trigger lives in the auth schema but executes a public function.
-- Must be dropped before the function can be dropped.
drop trigger if exists on_auth_user_created on auth.users;

-- ── 2. Drop the handle_new_user function ───────────────────────────────────
drop function if exists public.handle_new_user();

-- ── 3. Drop the set_updated_at trigger on profiles ─────────────────────────
drop trigger if exists set_updated_at_profiles on public.profiles;

-- ── 4. Drop RLS policies that reference public.profiles ────────────────────
-- These policies are dead code (app uses service-role key, bypasses RLS).
-- They must be dropped before the profiles table because the policy bodies
-- reference it.

-- Profiles policies (drop with the table, but explicit is safer).
drop policy if exists "Profiles are viewable by own user" on public.profiles;
drop policy if exists "Profiles updatable by own user" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;

-- Announcements admin-write policy (references profiles in subquery).
-- The "publicly readable" policy has no profile reference and is kept.
drop policy if exists "Admins can manage announcements" on public.announcements;

-- Admin years admin-write policy.
drop policy if exists "Admins can manage admin years" on public.admin_years;

-- Officers admin-write policy.
drop policy if exists "Admins can manage officers" on public.officers;

-- Contact messages admin policies (read/update/delete all reference profiles).
-- The "Anyone can submit contact messages" insert policy has no reference and is kept.
drop policy if exists "Admins can read contact messages" on public.contact_messages;
drop policy if exists "Admins can update contact messages" on public.contact_messages;
drop policy if exists "Admins can delete contact messages" on public.contact_messages;

-- ── 5. Drop storage RLS policies that reference public.profiles ────────────
-- Public-read policies are kept (no profile reference). Admin-write policies
-- that reference profiles are dropped. Public bucket reads via the public
-- URL do not go through RLS, so dropping these is safe.
drop policy if exists "Admins can upload officer photos" on storage.objects;
drop policy if exists "Admins can delete officer photos" on storage.objects;
drop policy if exists "Admins can upload announcement images" on storage.objects;
drop policy if exists "Admins can delete announcement images" on storage.objects;

-- ── 6. Drop the profiles table ─────────────────────────────────────────────
-- This removes the cross-schema FK (public.profiles.id -> auth.users.id).
-- After this, Prisma db push will no longer need "auth" in schemas.
drop table if exists public.profiles;

-- ── 7. Disable RLS on the remaining tables ────────────────────────────────
-- The app uses the service-role key (bypasses RLS). With the admin-write
-- policies gone, RLS would deny all non-service-role access. Disabling RLS
-- is cleaner than leaving it half-configured. Per 06 section 1: a layer
-- that is never exercised is a layer that may have silently rotted.
alter table public.announcements disable row level security;
alter table public.admin_years disable row level security;
alter table public.officers disable row level security;
alter table public.contact_messages disable row level security;

-- ── 8. Drop the remaining no-op RLS policies ──────────────────────────────
-- Now that RLS is disabled, these policies are inert. Drop them for tidiness.
drop policy if exists "Announcements are publicly readable" on public.announcements;
drop policy if exists "Admin years are publicly readable" on public.admin_years;
drop policy if exists "Officers are publicly readable" on public.officers;
drop policy if exists "Anyone can submit contact messages" on public.contact_messages;
drop policy if exists "Public can read officer photos" on storage.objects;
drop policy if exists "Public can read announcement images" on storage.objects;
