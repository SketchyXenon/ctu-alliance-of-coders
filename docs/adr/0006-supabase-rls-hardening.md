# ADR 0006 - Supabase RLS hardening and leaked-password-protection warning

Status: Accepted
Date: 2026-08-11
Decider: Z.ai (main), based on Supabase database-linter findings.

## Context

The Supabase database linter reported 6 findings on the production database:

| # | Finding | Level | Table / Scope |
| --- | --- | --- | --- |
| 1 | rls_disabled_in_public | ERROR | admin_mfa_challenges |
| 2 | rls_disabled_in_public | ERROR | admin_invites |
| 3 | rls_disabled_in_public | ERROR | integration_configs |
| 4 | sensitive_columns_exposed | ERROR | integration_configs.secret |
| 5 | rls_policy_always_true | WARN | contact_messages INSERT (WITH CHECK true) |
| 6 | auth_leaked_password_protection | WARN | Supabase Auth (dashboard setting) |

### Root cause (issues 1-4)

The consolidated migration `supabase/migrations/00000000000000_init.sql`
creates 8 tables and enables RLS on all of them. Three tables added later to
support the MFA, invite, and integrations features (`AdminMfaChallenge`,
`AdminInvite`, `IntegrationConfig` in `prisma/schema.prisma`) were never added
to the Supabase migration. They were created in production by `prisma db
push`, which creates tables without RLS. As a result, anon and authenticated
keys could read/write these tables directly via PostgREST — including the
`secret` column in `integration_configs`, which stores integration credentials
(API keys, webhook secrets for Mailchimp/SendGrid/Discord/etc.).

### Issue 5 (contact_messages INSERT)

The `Contact messages public insert` policy used `WITH CHECK (true)` to allow
any visitor to submit the public contact form. Functionally correct for a
public form, but the linter flags unrestricted INSERT/UPDATE/DELETE policies.

### Issue 6 (leaked password protection)

Supabase Auth's leaked-password-protection feature (checks against
HaveIBeenPwned.org) is disabled. This is a dashboard setting, not a SQL
migration.

## Decision

### Issues 1-4: new migration creates the 3 missing tables and enables RLS

A new migration `supabase/migrations/20260811000000_rls_hardening.sql`:

- Creates `admin_mfa_challenges`, `admin_invites`, `integration_configs` with
  `CREATE TABLE IF NOT EXISTS` (safe on DBs where Prisma already created
  them; creates them on fresh DBs).
- Adds the indexes mirroring Prisma's `@@index` directives.
- Enables RLS on all 3 tables with **NO policies** — admin-only tables. The
  service role (app, server-side) bypasses RLS; all anon/authenticated access
  is denied by default (fail closed). Per 06 section 3: default deny.
- Adds an `updated_at` trigger for `integration_configs` (mirrors Prisma's
  `@updatedAt`), reusing the existing `public.update_updated_at()` function.

This follows the same pattern as the other admin-only tables
(`admin_users`, `admin_sessions`, `activity_logs`, `page_views`) in the init
migration: RLS enabled, no policies, service role bypasses, default deny.

### Issue 5: tighten the contact_messages INSERT policy

Replaced `WITH CHECK (true)` with `WITH CHECK (...)` that validates input
shape, mirroring the server-side validation in `src/app/api/contact/route.ts`:

- `name`: 2-80 chars
- `subject`: 3-120 chars
- `message`: 10-2000 chars
- `email`: basic format regex (`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
- `category`: allowlist of the 6 CONTACT_TOPICS values

This is defense-in-depth (06 section 1): the app's server-side validation
remains the primary control (full business-logic validation, rate limiting,
CRLF rejection); the RLS policy adds a second layer for any direct PostgREST
call that bypasses the app. The linter's concern (non-trivial `WITH CHECK`)
is addressed. Per 03 section 1 (DRY): the validation limits are duplicated in
two places (app + RLS), but this is intentional defense-in-depth, not
accidental duplication — the RLS policy is a constrained subset (shape only,
no business logic like rate limiting).

### Issue 6: leaked password protection is N/A (custom auth)

The app uses a custom cookie-session auth system (ADR-0001), NOT Supabase
Auth. Passwords are hashed with argon2id in the application layer
(`src/lib/auth.ts`), not stored in Supabase Auth's `auth.users` table.
Supabase Auth's leaked-password-protection setting therefore has no effect on
the app's authentication.

No SQL/migration change is made for this finding. If Supabase Auth is ever
adopted (which ADR-0001 explicitly decided against), leaked password
protection should be enabled in the Supabase dashboard at that time.

## Consequences

- The 3 missing tables now exist in both the Prisma schema and the Supabase
  migration, eliminating the schema drift that caused issues 1-4. Fresh
  Supabase databases will have RLS enabled from the start.
- The `integration_configs.secret` column is protected by default-deny RLS.
  Even if the anon key is compromised, the secret cannot be read via
  PostgREST. The app reads it only via the service role (server-side).
- The `contact_messages` INSERT policy is now non-trivial, satisfying the
  linter. A direct PostgREST insert with malformed data (empty fields,
  invalid email, disallowed category) will be rejected by RLS even if it
  bypasses the app.
- The `auth_leaked_password_protection` warning will persist in the Supabase
  linter output because it is a dashboard setting we cannot change via SQL.
  This ADR documents why it is not applicable.

## Trade-off (explicit, 02 section 9)

- **Schema drift vs. migration safety**: we chose to ADD a new migration
  rather than edit the init migration (per ADR-0003's precedent: never edit
  an applied migration). The cost is two migration files; the benefit is that
  databases that already applied the init migration are not left in an
  inconsistent state.
- **Validation duplication (issue 5)**: the contact input limits exist in both
  `src/app/api/contact/route.ts` (primary) and the RLS policy (defense-in-
  depth). If the app's limits change, the RLS policy must be updated too.
  This is intentional — the RLS policy is the last line of defense, not the
  primary validation. The cost is a small maintenance burden; the benefit is
  that a direct PostgREST call cannot bypass input-shape validation.

## Verification

- The migration is idempotent: every statement uses `IF NOT EXISTS` or
  `DROP IF EXISTS` first. Safe to run on a DB where Prisma already created
  the tables.
- After applying the migration, the Supabase linter should report 0 ERROR
  findings and the `auth_leaked_password_protection` WARN (documented as
  N/A here).
- `prisma db push` against a database with this migration applied will
  report zero drift (the SQL mirrors Prisma column-for-column).
