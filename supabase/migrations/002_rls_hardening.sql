-- RLS hardening - addresses Supabase database-linter findings (2026-08-11).
--
-- Fixes:
--   1. rls_disabled_in_public on admin_mfa_challenges (ERROR)
--   2. rls_disabled_in_public on admin_invites (ERROR)
--   3. rls_disabled_in_public on integration_configs (ERROR)
--   4. sensitive_columns_exposed on integration_configs.secret (ERROR)
--   5. rls_policy_always_true on contact_messages INSERT (WARN)
--   6. auth_leaked_password_protection (WARN) - N/A, see ADR-0006.
--
-- Root cause (issues 1-4): the 3 tables exist in prisma/schema.prisma but
-- were never added to the Supabase migration. They were created in prod by
-- `prisma db push` directly, which does not enable RLS. This migration
-- creates them (IF NOT EXISTS, so safe on DBs where Prisma already made
-- them), adds indexes, and enables RLS with NO policies (admin-only tables;
-- service role bypasses RLS, all other access denied by default = fail
-- closed). Per 06 section 3: default deny.
--
-- Fix for issue 5: the contact_messages INSERT policy used WITH CHECK (true).
-- Functionally correct for a public form, but the linter flags unrestricted
-- access. Tightened to WITH CHECK (...) that validates input shape (non-empty
-- fields, length limits, email format, category allowlist) - mirroring the
-- server-side validation in src/app/api/contact/route.ts. This is
-- defense-in-depth: even if a direct PostgREST call bypasses the app, the
-- RLS policy still enforces basic input shape. Per 06 section 1.
--
-- Issue 6 (auth_leaked_password_protection): this is a Supabase Auth dashboard
-- setting, not a SQL change. The app uses custom cookie-session auth
-- (ADR-0001), NOT Supabase Auth, so the warning is not applicable. If
-- Supabase Auth is ever enabled, enable leaked password protection in the
-- dashboard. Documented in ADR-0006.
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS or DROP IF EXISTS first.
-- Safe to run on a DB where Prisma already created the tables (the CREATE
-- TABLE IF NOT EXISTS skips, the ALTER TABLE ENABLE RLS applies to the
-- existing table). Per 03 section 6: fail safe.

-- ============================================================================
-- 1. admin_mfa_challenges (mirrors prisma/schema.prisma AdminMfaChallenge)
-- ============================================================================

create table if not exists public.admin_mfa_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.admin_users(id) on delete cascade,
  code_hash   text not null,
  attempts    int not null default 0,
  consumed    boolean not null default false,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_mfa_challenges_user    on public.admin_mfa_challenges(user_id);
create index if not exists idx_admin_mfa_challenges_expires  on public.admin_mfa_challenges(expires_at);

alter table public.admin_mfa_challenges enable row level security;
-- NO policies: admin-only table. Service role (app) bypasses RLS; all other
-- access denied by default. Per 06 section 3: default deny.

-- ============================================================================
-- 2. admin_invites (mirrors prisma/schema.prisma AdminInvite)
-- ============================================================================

create table if not exists public.admin_invites (
  id           uuid primary key default gen_random_uuid(),
  email         text not null,
  role          text not null default 'admin',
  token_hash    text unique not null,
  created_by    uuid not null references public.admin_users(id) on delete cascade,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       text,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_admin_invites_email    on public.admin_invites(email);
create index if not exists idx_admin_invites_created_by on public.admin_invites(created_by);
create index if not exists idx_admin_invites_expires   on public.admin_invites(expires_at);

alter table public.admin_invites enable row level security;
-- NO policies: admin-only table (token_hash is a sensitive credential).
-- Service role bypasses RLS; all other access denied by default.

-- ============================================================================
-- 3. integration_configs (mirrors prisma/schema.prisma IntegrationConfig)
--    Contains the `secret` column (issue #4: sensitive_columns_exposed).
-- ============================================================================

create table if not exists public.integration_configs (
  id          text primary key,
  enabled     boolean not null default false,
  config      text not null default '',
  secret      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.integration_configs enable row level security;
-- NO policies: admin-only table. The `secret` column stores integration
-- credentials (API keys, webhook secrets). RLS denies all anon/authenticated
-- access; only the service role (app, server-side) can read/write. Per
-- 06 section 8: secrets never exposed to the client.

-- updated_at trigger for integration_configs (Prisma @updatedAt mirror).
drop trigger if exists set_updated_at_integration_configs on public.integration_configs;
create trigger set_updated_at_integration_configs
  before update on public.integration_configs
  for each row execute function public.update_updated_at();

-- ============================================================================
-- 4. Tighten contact_messages INSERT policy (issue #5: rls_policy_always_true)
-- ============================================================================
-- Replace WITH CHECK (true) with input-shape validation mirroring the
-- server-side validation in src/app/api/contact/route.ts:
--   name:    2-80 chars
--   subject: 3-120 chars
--   message: 10-2000 chars
--   email:   basic format (contains @ and .)
--   category: one of the allowed CONTACT_TOPICS values
-- This is defense-in-depth: the app validates server-side (primary control);
-- RLS adds a second layer for direct PostgREST access. Per 06 section 1.

drop policy if exists "Contact messages public insert" on public.contact_messages;

create policy "Contact messages public insert"
  on public.contact_messages for insert
  with check (
    length(name) >= 2 and length(name) <= 80
    and length(subject) >= 3 and length(subject) <= 120
    and length(message) >= 10 and length(message) <= 2000
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and category in ('General Inquiry', 'Membership', 'Events', 'Technical Support', 'Partnerships', 'Other')
  );

-- ============================================================================
-- DONE. All 6 linter findings addressed:
--   Issues 1-4 (ERROR): RLS enabled on the 3 missing tables; integration_configs
--     secret column now protected by default-deny RLS.
--   Issue 5 (WARN): contact_messages INSERT policy tightened with input checks.
--   Issue 6 (WARN): N/A (custom auth) - documented in ADR-0006.
-- ============================================================================
