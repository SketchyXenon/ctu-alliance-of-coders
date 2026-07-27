-- Alliance of Coders - comprehensive production cleanup (v3).
-- Run this ONCE in the Supabase dashboard > SQL Editor > New query.
--
-- IMPORTANT: triggers depend on functions. Drop triggers BEFORE functions.
-- This script does everything in the correct dependency order:
--   1. Drop all RLS policies (depend on profiles table)
--   2. Drop profiles table (now safe, nothing depends on it)
--   3. Drop all triggers that use update_updated_at (depend on the function)
--   4. Recreate update_updated_at with fixed search_path
--   5. Recreate triggers
--   6. Disable RLS (dead code)
--
-- Idempotent: safe to run multiple times.

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: Drop ALL RLS policies (they reference profiles)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "Profiles are viewable by own user" on public.profiles;
drop policy if exists "Profiles updatable by own user" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Announcements are publicly readable" on public.announcements;
drop policy if exists "Admins can manage announcements" on public.announcements;
drop policy if exists "Admin years are publicly readable" on public.admin_years;
drop policy if exists "Admins can manage admin years" on public.admin_years;
drop policy if exists "Officers are publicly readable" on public.officers;
drop policy if exists "Admins can manage officers" on public.officers;
drop policy if exists "Anyone can submit contact messages" on public.contact_messages;
drop policy if exists "Admins can read contact messages" on public.contact_messages;
drop policy if exists "Admins can update contact messages" on public.contact_messages;
drop policy if exists "Admins can delete contact messages" on public.contact_messages;
drop policy if exists "Public can read officer photos" on storage.objects;
drop policy if exists "Admins can upload officer photos" on storage.objects;
drop policy if exists "Admins can delete officer photos" on storage.objects;
drop policy if exists "Public can read announcement images" on storage.objects;
drop policy if exists "Admins can upload announcement images" on storage.objects;
drop policy if exists "Admins can delete announcement images" on storage.objects;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: Drop profiles table + handle_new_user (now safe)
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop trigger if exists set_updated_at_profiles on public.profiles;
drop table if exists public.profiles;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: Drop ALL triggers that use update_updated_at (BEFORE the function)
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists set_updated_at_announcements on public.announcements;
drop trigger if exists set_updated_at_admin_years on public.admin_years;
drop trigger if exists set_updated_at_officers on public.officers;
drop trigger if exists set_updated_at_contact on public.contact_messages;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: Recreate update_updated_at with fixed search_path (security linter)
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.update_updated_at();

create function public.update_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5: Recreate triggers (after the function exists)
-- ═══════════════════════════════════════════════════════════════════════════

create trigger set_updated_at_announcements
  before update on public.announcements
  for each row execute function public.update_updated_at();

create trigger set_updated_at_admin_years
  before update on public.admin_years
  for each row execute function public.update_updated_at();

create trigger set_updated_at_officers
  before update on public.officers
  for each row execute function public.update_updated_at();

create trigger set_updated_at_contact
  before update on public.contact_messages
  for each row execute function public.update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 6: Disable RLS (dead code, service-role key bypasses it)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.announcements disable row level security;
alter table public.admin_years disable row level security;
alter table public.officers disable row level security;
alter table public.contact_messages disable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. Now run: bun run db:push  →  then redeploy on Vercel.
-- ═══════════════════════════════════════════════════════════════════════════
