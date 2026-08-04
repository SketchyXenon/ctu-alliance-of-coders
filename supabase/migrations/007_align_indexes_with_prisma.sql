-- Alliance of Coders - align Supabase indexes with prisma/schema.prisma.
--
-- Per ADR-0002: keep the dual SQLite/Postgres schema, but close drift so
-- `prisma db push` reports zero diff and dev reproduces prod query plans.
-- Per ADR-0003: do NOT edit applied migrations; ship a new one instead.
--
-- Two indexes in the cumulative Supabase schema have no counterpart in
-- prisma/schema.prisma. They are harmless but cause `db push` to leave stray
-- indexes and make the schema files disagree about the read paths:
--
--   1. idx_announcements_created (created_at desc)
--      Prisma defines @@index([date(sort: Desc)]) but NOT one on created_at.
--      The announcements GET orders by [pinned, date, createdAt] with take:200,
--      so the date index carries the seek; the created_at index is dead weight.
--
--   2. idx_admin_users_email (email)
--      Redundant: admin_users.email is UNIQUE, which already creates an
--      implicit index that serves every email lookup. Prisma models it as
--      @unique only (no @@index), so the explicit index is pure drift.
--
-- Idempotent (drop index if exists). Non-destructive: no data or columns
-- change, only two redundant indexes are removed. Per 03 section 6: fail safe.
-- Per 06 section 8: data minimization (no new data collected).

drop index if exists public.idx_announcements_created;
drop index if exists public.idx_admin_users_email;

-- Verification note: after this runs, the cumulative Supabase schema matches
-- prisma/schema.prisma column-for-column and index-for-index. The CHECK
-- constraints on announcements.type and contact_messages.status are an
-- intentional Supabase-side defense-in-depth superset (the app's
-- AnnouncementType / ContactStatus unions are subsets of these), kept per
-- 06 section 1, not a drift defect.
