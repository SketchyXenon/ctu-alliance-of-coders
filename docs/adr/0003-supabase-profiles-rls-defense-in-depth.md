# ADR 0003 - Supabase profiles table and RLS kept as defense-in-depth

Status: Accepted
Date: 2026-07-23
Decider: Docs and CI Agent (W4), based on assessment finding H10.

## Context

The Supabase migration `supabase/migrations/20260721000000_init_schema.sql`
creates a `profiles` table that references `auth.users(id)`, a
`handle_new_user()` trigger that auto-inserts a profile when a Supabase Auth
user is created, and row-level-security policies on every table that call
`auth.uid()` to scope reads and writes by the calling Supabase Auth user.

The application does not use Supabase Auth. Per ADR 0001, authentication is a
custom cookie-session system backed by the `AdminUser` and `AdminSession`
Prisma models. The app talks to Supabase only through the service-role key
(`src/lib/supabase.ts`), which bypasses RLS entirely. So the `profiles`
table, the `handle_new_user()` trigger, and every `auth.uid()`-based RLS
policy are dead code - they are never exercised by the running application.

The assessment (subagent A, finding H10) flagged this as an auth-model drift
risk: two parallel auth systems (Supabase Auth + custom) invite split-brain
bugs if someone later wires Supabase Auth in without removing the custom
system. docs/SECURITY.md already discloses the RLS-bypass-via-service-role
behavior honestly.

06 section 1 calls for defense in depth: no single control is the only thing
standing between an attacker and the data. RLS that is never exercised
provides zero depth today, but it would provide depth the moment Supabase
Auth is enabled - so it is not worthless, just dormant.

## Decision

- Keep the migration as-is. Editing an applied Supabase migration is risky:
  Supabase tracks migrations by filename and applies each exactly once, so
  a hand-edit to `20260721000000_init_schema.sql` would not re-run on
  databases that have already applied it, leaving prod and dev out of sync.
  A new migration is the correct tool for cleanup, and that is deferred.
- Document in this ADR, in docs/SECURITY.md, and in docs/activity-log.md
  that the `profiles` table, the `handle_new_user()` trigger, and the
  `auth.uid()`-based RLS policies are defense-in-depth only and are not
  exercised by the application today.
- Track a follow-up: a future Supabase migration should either remove the
  unused `profiles` infrastructure entirely (if Supabase Auth will never be
  adopted) or properly adopt Supabase Auth and remove the custom
  cookie-session system (if it will). Either path requires its own ADR.

## Consequences

- Misleading if someone enables Supabase Auth later without reading this
  ADR or docs/SECURITY.md: they would reasonably expect `profiles` and the
  RLS policies to be wired into the running app, and they are not. The
  documentation above is the mitigation.
- The service-role key bypasses RLS regardless of these policies. This is
  already documented in docs/SECURITY.md and is the reason RLS here is
  defense-in-depth, not a primary control. 06 section 1: layer controls so
  one failure is not a breach - but a layer that is never exercised is a
  layer that may have silently rotted. The follow-up migration is the fix.
- Storage RLS for the officer-photos and announcement-images buckets is in
  the same migration and has the same status: defense-in-depth only, since
  the app uploads via the service-role key. Same mitigation: documented
  here, cleanup deferred.
- Trade-off (per 02 section 9): we trade a clean schema for the safety of
  not editing an applied migration. The price is dormant infrastructure
  that must be documented and eventually cleaned up.

## Trade-off (explicit, 02 section 9)

Clean schema vs. safety of not editing an applied migration. We chose
safety; the cost is dormant `profiles` infrastructure, a documented
split-brain risk if Supabase Auth is later enabled, and a follow-up
migration to write.
