# activity-log

Manually-curated summary of major decisions and changes for the Alliance of
Coders Next.js app. This is NOT a build log (the root worklog.md is the build
log). Entries are reverse-chronological. Per Z.md: no emojis, kebab-case
filenames, do not auto-commit.

## 2026-07-23 - Docs and CI added (Task W4)

- Created docs/activity-log.md (this file) per Z.md line 13.
- Created four ADRs in docs/adr/ recording the significant decisions made
  during the fix phase (see ADR index below).
- Created .github/workflows/ci.yml running lint, typecheck, test, and build on
  push and pull request to main. Test step is wired up ahead of vitest being
  installed by the Test Suite Agent (W5); with no tests present the step is a
  no-op pass.
- Per Z.md line 17, neither this log nor the ADRs are auto-committed.

### ADR index

- 0001-custom-auth-not-nextauth.md - keep custom cookie-session auth, remove
  the unused next-auth dependency.
- 0002-dual-prisma-schema-drift.md - keep dual SQLite/Postgres schemas for now,
  close the index drift, fix db:migrate:prod to use migrate deploy.
- 0003-supabase-profiles-rls-defense-in-depth.md - keep the Supabase profiles
  table and RLS migration as-is, document it as dead code / defense-in-depth.
- 0004-caddyfile-ssrf-known-limitation.md - keep the Caddyfile transform-port
  block required by the sandbox, document the SSRF risk and mitigations.

## 2026-07-23 - Fix phase (Critical and High)

Phase 1 and Phase 2 fixes applied by parallel fix agents against the
assessment recommendations. Each fix was verified with lint plus a manual API
smoke; full detail is in the root worklog.md.

### Critical

- C1 Secrets untracked. .env and db/custom.db removed from git tracking; db
  db/*.db added to .gitignore. Admin passwords created in the dev DB must be
  treated as compromised and rotated.
- C2 Caddyfile hardened. Kept the @transform_port_query block (required by the
  sandbox gateway convention) but added X-Content-Type-Options,
  X-Frame-Options, Referrer-Policy, Permissions-Policy, and
  Strict-Transport-Security headers, and documented the SSRF risk as ADR 0004.
- C3 build.sh stopped shipping the dev SQLite DB into the prod artifact. Prod
  now requires an external Postgres DATABASE_URL; db:migrate:prod now uses
  prisma migrate deploy (non-interactive, non-destructive) instead of migrate
  dev.

### High

- H1 Contact IDOR / PII leak on dedup closed. POST /api/contact now returns
  only { ok, deduplicated } on a P2002 idempotency hit, never the existing
  message DTO.
- H2 /api/sessions token leak closed. The session list now returns a hashed
  surrogate id instead of the raw cookie value; DELETE /api/sessions/[id] is
  re-keyed to the surrogate.
- H3 CSV formula injection fixed. csvEscape now prefixes any cell starting
  with = + - @ \t \r with a single quote before quoting.
- H4 Test scaffold. vitest and @testing-library/react are being added by the
  Test Suite Agent (W5); the test script and CI step are in place ahead of
  the first test files.
- H5 ESLint rules re-enabled and typecheck script added. no-explicit-any,
  no-unused-vars, prefer-const, no-debugger, no-unreachable,
  react-hooks/exhaustive-deps, and react-compiler are back on; tsconfig
  noImplicitAny set to true; bun run typecheck wired into CI.
- H6 CSP and HSTS added to next.config.ts so static asset paths the proxy
  matcher skips also get the security header set.
- H7 CI pipeline added (.github/workflows/ci.yml) - see entry above.
- H8 Dead dependencies removed: next-auth, next-intl, z-ai-web-dev-sdk,
  @reactuses/core, react-syntax-highlighter, @mdxeditor/editor, uuid.
- H9 .env.example created from the zod schema in src/lib/env.ts with
  placeholders only.
- H10 Supabase/Prisma auth-model drift resolved by ADR 0003 - profiles, the
  handle_new_user trigger, and the auth.uid()-based RLS are documented as
  defense-in-depth dead code rather than removed (editing an applied
  migration is risky).
- H11 Dual Prisma schema drift partially resolved by ADR 0002 - missing
  dev-side indexes added, db:migrate:prod fixed; full schema unification
  deferred.

### Medium (applied, selected)

- M5 Failed-login log now masks the email (u***@example.com) in the warn
  line; full email kept only in the access-controlled ActivityLog audit
  trail.
- M16 Next.js 16 middleware convention renamed: src/middleware.ts is now
  src/proxy.ts (Next 16 deprecation).
- M7 GET /api/health now has per-IP rate limiting (60/min) and
  Cache-Control: no-store, preventing DoS via repeated DB pings.
- Other Medium items (TOCTOU on createSession, api-client timeout, XFF trust,
  withPrismaError consistency, in-memory rate limiter, MFA, reduced-motion,
  gold contrast, div-as-button, canonical URLs, oversized file splits) are
  deferred - see "What remains" below.

## 2026-07-23 - Assessment phase

Five parallel read-only assessment subagents (Task IDs 2-a through 2-e)
scanned the extracted codebase line-by-line against the eight source-of-truth
markdowns in upload/. Subagent scope:

- 2-a config, infrastructure, schema (package.json, tsconfig, eslint,
  next.config, prisma schemas, Caddyfile, shell scripts, .gitignore).
- 2-b API route handlers (every route under src/app/api).
- 2-c lib, middleware/hooks, and cross-cutting concerns (src/lib, src/proxy,
  src/hooks).
- 2-d UI/UX components and design system (src/components, globals.css).
- 2-e app-level files, docs, examples, and public assets.

Findings were aggregated in ASSESS-FINAL into ~100 unique recommendations
prioritized as Critical (3), High (16), Medium (17), and Low (16), plus a
strengths list (10 items worth keeping). The aggregated report drives the fix
phase above and the deferred work below.

## What remains (deferred)

Tracked as tech debt per 03 section 7. Each item should be picked up by a
future task; none block the current ship.

### Frontend / UI / UX (Phase 3 of the assessment)

- H12 Replace logo.png (454 KB) with a single-color inline SVG mark; generate
  a real favicon set and a manifest.
- H13 Flatten the ~12 gradient surfaces to confident flat color; reserve at
  most one gradient as the signature; demote competing decorative motifs.
- H14 Add an h1 to every non-Home view (promote SectionHeading or render an
  sr-only h1 per active section).
- H15 Wrap inbox-message delete and officer-row delete in a confirmation
  AlertDialog (year delete already has one - make it consistent).
- M10 Add prefers-reduced-motion overrides for page-loader, skeleton shimmer,
  animate-ping, animate-spin.
- M11 Darken gold-600/gold-500 on light surfaces to meet WCAG AA 4.5:1.
- M12 Replace div-as-button in officer-card with a real button overlay; fix
  the duplicate h2 in officer-modal.
- M13 Add rel=canonical, export const viewport, generate a favicon set and a
  web manifest.
- M14 Delete the static public/robots.txt so src/app/robots.ts owns the route.
- M15 Split the seven oversized component files (>400 lines) into
  sub-components.

### Security hardening (Phase 2 remainder)

- M2 Wrap createSession's findMany/ deleteMany/ create in a db.$transaction
  to close the max-sessions TOCTOU race.
- M3 Fix api-client header-merge bug and add an AbortSignal.timeout(10s) so
  fetches cannot hang.
- M4 Stop trusting the leftmost X-Forwarded-For for rate-limit keys (use the
  platform IP / rightmost; fall back to a global bucket when unknown).
- M6 Apply withPrismaError consistently across the 13 unwrapped routes; stop
  swallowing DB errors as 401 in routes that catch requireAdmin.
- M8 Replace the in-memory rate limiter with a Redis/Upstash-backed one so
  limits do not multiply by instance count in multi-instance prod.
- M9 Add TOTP MFA for admin accounts (second factor plus /api/auth/mfa/verify).
- H4 (remainder) Author the first test files once vitest is installed by W5:
  login enumeration-safety, requireAdmin 401 on every admin route, IDOR on
  /api/sessions/[id], contact P2002-dedup regression, csvEscape
  formula-injection regression, rate-limit 429.

### Tech debt and docs (Phase 4)

- ADR 0002 follow-up: add a CI diff check comparing schema.prisma and
  schema.prod.prisma so future drift is caught automatically; a future ADR
  should propose unifying to a single schema.
- ADR 0003 follow-up: a future Supabase migration should clean up the unused
  profiles table, handle_new_user trigger, and auth.uid()-based RLS (or
  properly adopt Supabase Auth).
- ADR 0004 follow-up: in a real multi-tenant deployment, restrict the
  Caddyfile transform-port query to an allowlist of known mini-service ports
  or put a WAF in front.
- M17 Shell script hygiene: add pipefail and -u; replace Chinese/emoji
  comments with one-line English comments per Z.md.
- L8 Extract DRY helpers (TYPE_ICON, getInitials, timeAgo, useScrollProgress)
  into lib/hooks.
- L15 Add ADRs for any future significant decision (ssr:false SPA choice,
  etc.) following the 0001-0004 pattern.

## Strengths preserved

These were called out as above-average in the assessment and should be
preserved through future refactors: mass-assignment-safe PATCH routes,
enumeration-safe login with a dummy hash, session rotation on privilege
change, IDOR-safe /api/sessions/[id], atomic sort-order via transactions,
the nine-layer upload defense, middleware CSRF plus the full security-header
set, the navy/gold design-token system, the structured JSON logger with
request context, and the ActivityLog audit model.
