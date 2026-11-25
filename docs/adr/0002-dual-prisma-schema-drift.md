# ADR 0002 - Dual Prisma schema drift (SQLite dev, Postgres prod)

Status: Accepted
Date: 2026-07-23
Decider: Docs and CI Agent (W4), based on assessment finding H11.

## Context

The project carries two Prisma schemas:

- `prisma/schema.prisma` - SQLite provider, camelCase column names, used for
  local development and the test seed.
- `prisma/schema.prod.prisma` - Postgres provider, snake_case column names
  via `@map`, plus extra indexes that the dev schema lacks.

The assessment (subagent A, finding H11) found three problems:

1. The two schemas had drifted - `schema.prod.prisma` carried indexes that
   `schema.prisma` did not, so dev did not reproduce prod query plans and
   raw SQL tested in dev could break in prod.
2. The `db:migrate:prod` npm script used `prisma migrate dev`, which is
   interactive and can reset data - the wrong tool for production.
3. There was no automated check preventing future drift.

02 section 4 calls out SQL-for-structured-data with strong consistency needs
(which this app has) and warns that indexing trades write speed for read
speed - index what is queried, not everything. 03 section 7 says every
dependency and every duplication is a liability that must be tracked
explicitly rather than left to hide.

## Decision

- Keep both schemas for now. SQLite is valuable for local dev: it needs no
  server, no Docker, no network, and lets a new contributor boot the app in
  under a minute. Unifying to Postgres everywhere would raise the local-dev
  setup cost; unifying to SQLite everywhere is impossible because prod runs
  on Postgres.
- Close the existing drift by adding the missing dev-side indexes to
  `schema.prisma` so the read paths exercised in dev match the ones prod
  will use. (Applied as part of H11.)
- Fix `db:migrate:prod` to use `prisma migrate deploy` (non-interactive,
  non-destructive, the documented production migration tool). (Applied;
  package.json now reads `prisma migrate deploy --schema=prisma/schema.prod.prisma`.)
- Add a follow-up item (see Consequences) to add a CI diff check that fails
  when the two schemas drift on indexes or column shapes. Not yet
  implemented; tracked in docs/activity-log.md under "What remains".

## Consequences

- Dev still will not perfectly reproduce prod query plans: SQLite and
  Postgres have different planners, different type coercion, and different
  case-sensitivity defaults. Code that relies on Postgres-specific behavior
  (e.g. `ilike`, JSONB operators, array columns) cannot be exercised
  against the dev DB and must be tested against a real Postgres instance
  before merge.
- Risk of future drift remains. The CI diff check (above) is the mitigation
  once it lands; until then, anyone editing one schema must remember to
  edit the other.
- A future ADR should propose unifying to a single schema. The two realistic
  paths are: (a) generate `schema.prod.prisma` from `schema.prisma` via a
  script that adds `@map` annotations and provider-specific indexes, or
  (b) run Postgres in dev via docker-compose and drop the SQLite schema
  entirely. Both have non-trivial setup-cost trade-offs.
- Trade-off (per 02 section 9): we trade schema consistency and
  single-source-of-truth for a fast, serverless local-dev loop. The price
  is a documented risk of drift and a planner-mismatch gap that requires
  integration tests against real Postgres to close.

## Trade-off (explicit, 02 section 9)

Single-schema consistency vs. zero-friction local development. We chose
zero-friction local dev with SQLite; the cost is maintaining two schemas,
the ongoing drift risk, and the planner-mismatch gap that requires
integration tests against real Postgres to close.
