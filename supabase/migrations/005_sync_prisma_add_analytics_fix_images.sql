-- Alliance of Coders - sync Supabase schema with Prisma + analytics + fix broken images.
--
-- ROOT CAUSE OF BROKEN IMAGES: the cleanup migrations (20260725 + 20260726)
-- dropped the storage public-read RLS policies ("Public can read officer
-- photos" / "Public can read announcement images") and never recreated them.
-- With RLS still enabled on storage.objects but no read policies, public
-- image reads return 403 -> broken images. This migration recreates them.
--
-- ALSO adds: page_views (analytics), admin_users, admin_sessions,
-- activity_logs, officers.reports_to_id, announcements.links — so the
-- Supabase schema fully matches prisma/schema.prisma. After this runs,
-- `bun run db:push` won't need to make destructive changes.
--
-- Idempotent: safe to run multiple times. Run in Supabase dashboard >
-- SQL Editor, OR via `supabase db push`. Per 03 §6: fail safe. Per 06 §8:
-- data minimization (page_views stores only a daily hash, never raw IP).

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: Add missing columns to existing tables (non-destructive)
-- ═══════════════════════════════════════════════════════════════════════════

-- announcements.links: JSON-encoded array of {url, label}. Default '' so
-- existing rows get a valid empty value (the app treats '' as "no links").
alter table public.announcements
  add column if not exists links text not null default '';

-- officers.reports_to_id: self-referencing FK for the org-chart hierarchy.
-- Nullable so legacy rows + vacant slots work without a parent.
alter table public.officers
  add column if not exists reports_to_id uuid;

-- Add the self-referencing FK (idempotent: drop if exists first).
alter table public.officers
  drop constraint if exists officers_reports_to_id_fkey;
alter table public.officers
  add constraint officers_reports_to_id_fkey
  foreign key (reports_to_id) references public.officers(id)
  on delete set null;

-- Indexes for the new columns (match Prisma's @@index directives).
create index if not exists idx_officers_reports_to on public.officers(reports_to_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: Create missing tables (admin_users, admin_sessions, activity_logs)
-- ═══════════════════════════════════════════════════════════════════════════

-- Admin users (custom cookie-session auth, NOT Supabase Auth).
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_users_email on public.admin_users(email);

-- Admin sessions (server-side session store).
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_sessions_user on public.admin_sessions(user_id);
create index if not exists idx_admin_sessions_expires on public.admin_sessions(expires_at);

-- Activity log (admin audit trail).
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_user on public.activity_logs(user_id);
create index if not exists idx_activity_logs_created on public.activity_logs(created_at desc);
create index if not exists idx_activity_logs_entity on public.activity_logs(entity);

-- updated_at trigger for admin_users (reuses the existing update_updated_at fn).
drop trigger if exists set_updated_at_admin_users on public.admin_users;
create trigger set_updated_at_admin_users
  before update on public.admin_users
  for each row execute function public.update_updated_at();

-- RLS on the new tables (enabled per Supabase linter requirement; the app
-- uses the service-role key which bypasses RLS, so these are belt-and-suspenders).
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.activity_logs enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: Create page_views table (analytics)
-- ═══════════════════════════════════════════════════════════════════════════

-- Privacy-first page-view analytics. Per 06 §8 (data minimization): stores a
-- DAILY visitor hash (SHA-256 of IP + day), NEVER raw IP. No cookies, no PII.
create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  visitor_hash text,
  path text not null,
  referrer text,
  device text,
  country text,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_views_created on public.page_views(created_at);
create index if not exists idx_page_views_path on public.page_views(path);
create index if not exists idx_page_views_visitor on public.page_views(visitor_hash);

alter table public.page_views enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: FIX BROKEN IMAGES — recreate storage public-read RLS policies
-- ═══════════════════════════════════════════════════════════════════════════

-- The cleanup migrations dropped these policies. Without them, RLS on
-- storage.objects denies public reads -> officer photos and announcement
-- images return 403 -> broken images. Recreate them here.

-- Officer photos: public read.
drop policy if exists "Public can read officer photos" on storage.objects;
create policy "Public can read officer photos"
  on storage.objects for select
  using (bucket_id = 'officer-photos');

-- Announcement images: public read.
drop policy if exists "Public can read announcement images" on storage.objects;
create policy "Public can read announcement images"
  on storage.objects for select
  using (bucket_id = 'announcement-images');

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. After this runs, `bun run db:push` will report no drift (the Supabase
-- schema now matches prisma/schema.prisma), and images will load again.
-- ═══════════════════════════════════════════════════════════════════════════
