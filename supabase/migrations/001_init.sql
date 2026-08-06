-- Alliance of Coders - unified Supabase schema (single source of truth).
--
-- This is the consolidated, final-state schema for the Supabase Postgres
-- database. It replaces the previous seven incremental migrations
-- (001). It mirrors prisma/schema.prisma column-for-column
-- and index-for-index, so `prisma db push` reports zero drift after it runs.
--create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES (mirrors prisma/schema.prisma; @map -> snake_case column names)
-- ============================================================================

-- Announcements (public read, admin write).
create table if not exists public.announcements (
  id          text primary key,
  type        text not null default 'general'
              check (type in ('award', 'recognition', 'report', 'general')),
  title       text not null,
  body        text not null,
  image_url   text,
  links       text not null default '',           -- JSON array of {url, label}
  pinned      boolean not null default false,
  date        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Leadership years (public read, admin write).
create table if not exists public.admin_years (
  id          uuid primary key default gen_random_uuid(),
  year        text unique not null,
  theme       text not null default 'Set a leadership theme for this year.',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Officers (public read, admin write). Self-referencing hierarchy.
create table if not exists public.officers (
  id             uuid primary key default gen_random_uuid(),
  year_id        uuid not null references public.admin_years(id) on delete cascade,
  name           text not null default 'Vacant Slot',
  role           text not null default 'Open Position',
  image_url      text,
  sort_order     int not null default 0,
  reports_to_id  uuid,                            -- self-FK, nullable
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Self-referencing FK for the org-chart hierarchy (idempotent).
alter table public.officers
  drop constraint if exists officers_reports_to_id_fkey;
alter table public.officers
  add constraint officers_reports_to_id_fkey
  foreign key (reports_to_id) references public.officers(id)
  on delete set null;

-- Contact messages (public insert, admin read/update/delete).
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   text unique not null,
  name        text not null,
  email       text not null,
  subject     text not null,
  category    text not null default 'General Inquiry',
  message     text not null,
  status      text not null default 'new'
              check (status in ('new', 'read', 'resolved', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Admin users (custom cookie-session auth, NOT Supabase Auth).
create table if not exists public.admin_users (
  id             uuid primary key default gen_random_uuid(),
  email          text unique not null,
  name           text,
  password_hash  text not null,
  role           text not null default 'admin',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Admin sessions (server-side session store).
create table if not exists public.admin_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.admin_users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Activity log (admin audit trail).
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  summary     text not null,
  created_at  timestamptz not null default now()
);

-- Privacy-first page-view analytics (06 section 8: data minimization).
-- Stores a DAILY visitor hash (SHA-256 of IP + day), NEVER raw IP.
create table if not exists public.page_views (
  id            uuid primary key default gen_random_uuid(),
  visitor_hash  text,
  path          text not null,
  referrer      text,
  device        text,
  country       text,
  session_id    text,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- INDEXES (mirror prisma/schema.prisma @@index directives exactly)
-- ============================================================================

-- announcements
create index if not exists idx_announcements_type    on public.announcements(type);
create index if not exists idx_announcements_pinned   on public.announcements(pinned);
create index if not exists idx_announcements_date     on public.announcements(date desc);

-- admin_years
create index if not exists idx_admin_years_sort       on public.admin_years(sort_order);

-- officers
create index if not exists idx_officers_year          on public.officers(year_id);
create index if not exists idx_officers_sort          on public.officers(sort_order);
create index if not exists idx_officers_reports_to    on public.officers(reports_to_id);

-- contact_messages
create index if not exists idx_contact_status         on public.contact_messages(status);
create index if not exists idx_contact_created        on public.contact_messages(created_at desc);
create index if not exists idx_contact_email          on public.contact_messages(email);

-- admin_sessions
create index if not exists idx_admin_sessions_user    on public.admin_sessions(user_id);
create index if not exists idx_admin_sessions_expires on public.admin_sessions(expires_at);

-- activity_logs
create index if not exists idx_activity_logs_user     on public.activity_logs(user_id);
create index if not exists idx_activity_logs_created  on public.activity_logs(created_at desc);
create index if not exists idx_activity_logs_entity   on public.activity_logs(entity);

-- page_views
create index if not exists idx_page_views_created     on public.page_views(created_at);
create index if not exists idx_page_views_path        on public.page_views(path);
create index if not exists idx_page_views_visitor     on public.page_views(visitor_hash);

-- NOTE: no separate index on admin_users.email — the UNIQUE constraint above
-- already creates an implicit index that serves every email lookup. Adding a
-- duplicate explicit index was the drift fixed in the prior 20260801 migration.

-- ============================================================================
-- ROW LEVEL SECURITY (defense-in-depth; app uses service-role key)
-- ============================================================================


alter table public.announcements    enable row level security;
alter table public.admin_years      enable row level security;
alter table public.officers         enable row level security;
alter table public.contact_messages enable row level security;
alter table public.admin_users      enable row level security;
alter table public.admin_sessions   enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.page_views       enable row level security;

-- Drop any stale policies from prior migrations before recreating (idempotent).
drop policy if exists "Announcements public read"      on public.announcements;
drop policy if exists "Admin years public read"        on public.admin_years;
drop policy if exists "Officers public read"           on public.officers;
drop policy if exists "Contact messages public insert" on public.contact_messages;


create policy "Announcements public read"
  on public.announcements for select using (true);
create policy "Admin years public read"
  on public.admin_years for select using (true);
create policy "Officers public read"
  on public.officers for select using (true);

-- Anyone may submit a contact message (the public contact form).
create policy "Contact messages public insert"
  on public.contact_messages for insert with check (true);

-- admin_users, admin_sessions, activity_logs, page_views: NO policies.
-- Service role (app) bypasses RLS; all other access denied by default.

-- ============================================================================
-- STORAGE BUCKETS (public read via CDN URL, admin write via service role)
-- ============================================================================
-- Both buckets are public: true so getPublicUrl() CDN URLs load in raw <img>
-- tags without any RLS policy. NO storage.objects SELECT policy is defined:
-- a broad SELECT policy would let anyone LIST bucket contents (the Supabase
-- linter warns on this as public_bucket_allows_listing). Public CDN URLs
-- bypass RLS entirely, so reads work without a policy; writes are done with
-- the service role key (bypasses RLS). This is the correct, linter-clean
-- configuration.

insert into storage.buckets (id, name, public)
values ('officer-photos', 'officer-photos', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do update set public = true;

-- Drop any stale storage policies from prior migrations (idempotent). The
-- old "Public can read ..." SELECT policies are intentionally NOT recreated
-- (they enabled listing). The old admin-write policies referenced the dead
-- profiles table and were already dropped.
drop policy if exists "Public can read officer photos"        on storage.objects;
drop policy if exists "Public can read announcement images"   on storage.objects;
drop policy if exists "Admins can upload officer photos"      on storage.objects;
drop policy if exists "Admins can delete officer photos"      on storage.objects;
drop policy if exists "Admins can upload announcement images" on storage.objects;
drop policy if exists "Admins can delete announcement images" on storage.objects;

-- ============================================================================
-- UPDATED_AT TRIGGER (server-side truth; Prisma @updatedAt is client-side)
-- ============================================================================
-- SECURITY INVOKER + revoked EXECUTE from anon/authenticated (linter-clean).
-- Triggers depend on the function, so the function is created BEFORE the
-- triggers. Idempotent: drop + recreate.

drop trigger if exists set_updated_at_announcements   on public.announcements;
drop trigger if exists set_updated_at_admin_years     on public.admin_years;
drop trigger if exists set_updated_at_officers        on public.officers;
drop trigger if exists set_updated_at_contact         on public.contact_messages;
drop trigger if exists set_updated_at_admin_users     on public.admin_users;

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

revoke execute on function public.update_updated_at() from anon, authenticated;

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

create trigger set_updated_at_admin_users
  before update on public.admin_users
  for each row execute function public.update_updated_at();

-- ============================================================================
-- DONE. The schema now matches prisma/schema.prisma exactly. Run
-- `bun run db:push` to sync Prisma's client with this applied schema.
-- ============================================================================
