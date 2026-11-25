-- 2026-11-25: activity_logs.user_id must accept synthetic audit actors.
--
-- The application writes non-UUID actor ids into activity_logs.user_id for
-- actions performed without an admin session (e.g. the webhook publisher
-- writes userId = 'webhook'; future system actors follow the same pattern).
-- The column was declared `uuid NOT NULL` with no foreign key, so Postgres
-- rejected every such write with `invalid input syntax for type uuid` and the
-- audit row was silently dropped (the route logs a warning and continues).
--
-- Fix: widen the column to text. Safe because:
--   * there is no foreign key on user_id (it references admin_users.id by
--     convention only), and
--   * every existing value is already a valid uuid, so the cast is lossless.
--
-- Mirrors prisma/schema.prisma (ActivityLog.userId is now a plain String).

ALTER TABLE activity_logs
  ALTER COLUMN user_id TYPE text
  USING user_id::text;
