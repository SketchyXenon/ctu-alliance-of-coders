-- Alliance of Coders - Supabase schema with RLS and indexing
-- This is the production schema for Supabase Postgres. It mirrors the
-- Prisma/SQLite models used in development but adds RLS policies,
-- proper indexes, and storage buckets for images.

-- ── Extensions ────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── Profiles (maps to auth.users) ──────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_role on public.profiles(role);

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Announcements ──────────────────────────────────────────────────────────

create table if not exists public.announcements (
  id text primary key,
  type text not null default 'general' check (type in ('award', 'recognition', 'report', 'general')),
  title text not null,
  body text not null,
  image_url text,
  pinned boolean not null default false,
  date text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_type on public.announcements(type);
create index if not exists idx_announcements_pinned on public.announcements(pinned);
create index if not exists idx_announcements_date on public.announcements(date desc);
create index if not exists idx_announcements_created on public.announcements(created_at desc);

-- ── Admin Years (leadership years) ─────────────────────────────────────────

create table if not exists public.admin_years (
  id uuid primary key default uuid_generate_v4(),
  year text unique not null,
  theme text not null default 'Set a leadership theme for this year.',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_years_sort on public.admin_years(sort_order);

-- ── Officers ───────────────────────────────────────────────────────────────

create table if not exists public.officers (
  id uuid primary key default uuid_generate_v4(),
  year_id uuid not null references public.admin_years(id) on delete cascade,
  name text not null default 'Vacant Slot',
  role text not null default 'Open Position',
  image_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_officers_year on public.officers(year_id);
create index if not exists idx_officers_sort on public.officers(sort_order);

-- ── Contact Messages ───────────────────────────────────────────────────────

create table if not exists public.contact_messages (
  id uuid primary key default uuid_generate_v4(),
  client_id text unique not null,
  name text not null,
  email text not null,
  subject text not null,
  category text not null default 'General Inquiry',
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'resolved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contact_status on public.contact_messages(status);
create index if not exists idx_contact_created on public.contact_messages(created_at desc);
create index if not exists idx_contact_email on public.contact_messages(email);

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.announcements enable row level security;
alter table public.admin_years enable row level security;
alter table public.officers enable row level security;
alter table public.contact_messages enable row level security;

-- Profiles: users can read own profile, admins can read all
create policy "Profiles are viewable by own user"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles updatable by own user"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Announcements: public read, admin write
create policy "Announcements are publicly readable"
  on public.announcements for select
  using (true);

create policy "Admins can manage announcements"
  on public.announcements for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Admin Years: public read, admin write
create policy "Admin years are publicly readable"
  on public.admin_years for select
  using (true);

create policy "Admins can manage admin years"
  on public.admin_years for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Officers: public read, admin write
create policy "Officers are publicly readable"
  on public.officers for select
  using (true);

create policy "Admins can manage officers"
  on public.officers for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Contact Messages: anyone can insert (public contact form), only admins can read/update/delete
create policy "Anyone can submit contact messages"
  on public.contact_messages for insert
  with check (true);

create policy "Admins can read contact messages"
  on public.contact_messages for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Admins can update contact messages"
  on public.contact_messages for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Admins can delete contact messages"
  on public.contact_messages for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ── Storage Buckets ────────────────────────────────────────────────────────

-- Officer photos bucket (admin write, public read)
insert into storage.buckets (id, name, public)
values ('officer-photos', 'officer-photos', true)
on conflict (id) do nothing;

-- Announcement images bucket (admin write, public read)
insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do nothing;

-- Storage RLS: public read, admin write
create policy "Public can read officer photos"
  on storage.objects for select
  using (bucket_id = 'officer-photos');

create policy "Admins can upload officer photos"
  on storage.objects for insert
  with check (
    bucket_id = 'officer-photos' and
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Admins can delete officer photos"
  on storage.objects for delete
  using (
    bucket_id = 'officer-photos' and
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Public can read announcement images"
  on storage.objects for select
  using (bucket_id = 'announcement-images');

create policy "Admins can upload announcement images"
  on storage.objects for insert
  with check (
    bucket_id = 'announcement-images' and
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Admins can delete announcement images"
  on storage.objects for delete
  using (
    bucket_id = 'announcement-images' and
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ── Updated_at trigger ─────────────────────────────────────────────────────

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles
  before update on public.profiles
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_announcements on public.announcements;
create trigger set_updated_at_announcements
  before update on public.announcements
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_admin_years on public.admin_years;
create trigger set_updated_at_admin_years
  before update on public.admin_years
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_officers on public.officers;
create trigger set_updated_at_officers
  before update on public.officers
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_contact on public.contact_messages;
create trigger set_updated_at_contact
  before update on public.contact_messages
  for each row execute function public.update_updated_at();
