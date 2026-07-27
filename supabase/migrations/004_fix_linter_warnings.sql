-- Alliance of Coders - fix Supabase linter warnings (v2).
-- Run this ONCE in the Supabase dashboard > SQL Editor > New query.
-- Fixes:
--   1. RLS Disabled (ERROR): re-enable RLS on all public tables
--   2. SECURITY DEFINER on update_updated_at (WARN): switch to INVOKER + revoke EXECUTE
--
-- After this, the only remaining advisory is "Leaked Password Protection
-- Disabled" which is a dashboard toggle, not SQL.

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1: Re-enable RLS on all public tables (Supabase requires this)
-- The app uses the service-role key which bypasses RLS, so this is safe.
-- Anon/authenticated roles have no policies → no access (which is correct).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.announcements enable row level security;
alter table public.admin_years enable row level security;
alter table public.officers enable row level security;
alter table public.contact_messages enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2: update_updated_at — switch to SECURITY INVOKER + revoke EXECUTE
-- The function only needs to run via triggers (which execute as the table
-- owner). It does NOT need to be callable via REST (PostgREST) by anon or
-- authenticated users. Per Supabase linter recommendation.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop and recreate as SECURITY INVOKER (not DEFINER).
-- Triggers still work because they execute with the table owner's privileges.
drop function if exists public.update_updated_at();

create function public.update_updated_at()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Revoke EXECUTE from anon and authenticated (they should never call this
-- directly via PostgREST; only triggers use it).
revoke execute on function public.update_updated_at() from anon, authenticated;

-- Recreate the triggers (they were dropped when the function was dropped).
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
-- FIX 3: Leaked Password Protection — NOT a SQL fix.
-- Go to: Supabase Dashboard > Authentication > Providers > Email >
--        "Leaked password protection" → toggle ON.
-- ═══════════════════════════════════════════════════════════════════════════

-- Done. All SQL-fixable linter warnings are now resolved.
-- The only remaining advisory (leaked password protection) is a dashboard toggle.
