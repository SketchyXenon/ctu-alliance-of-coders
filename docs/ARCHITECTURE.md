# Architecture

## Overview

Single-page application with section-based navigation. All user-facing content
serves from `/` with client-side routing between sections. API routes handle
data operations with server-side authorization.

```
src/
  app/
    api/            - Route handlers (17 endpoints)
    layout.tsx      - Root layout (fonts, theme, metadata)
    page.tsx        - Main page (section router, state)
    globals.css     - Design tokens, utilities
    sitemap.ts      - Dynamic sitemap
    robots.ts       - Dynamic robots.txt
    opengraph-image.tsx - Dynamic OG image
  components/
    sections/       - Page sections (hero, announcements, officers, contact, admin, policy)
    admin/          - Admin sub-components (login, inbox, officers-manager, activity, sessions, settings)
    ui/             - shadcn/ui primitives
    gear-logo.tsx   - Brand logo
    site-nav.tsx    - Sticky navigation
    site-footer.tsx - Footer
    ...             - Shared components (back-to-top, command-palette, etc.)
  hooks/            - Custom hooks (keyboard shortcuts, count-up, parallax, command palette)
  lib/              - Server utilities (auth, db, security, logger, supabase, env, store)
  proxy.ts        - CSRF + security headers + request ID (Next 16 renamed middleware to proxy)
prisma/
  schema.prisma         - Dev schema (SQLite)
  schema.prod.prisma    - Production schema (PostgreSQL)
  seed.ts               - Initial data
supabase/
  migrations/       - SQL migration with RLS policies
scripts/
  bootstrap-admin.ts - First admin account creation
```

## Data Flow

```
Browser -> proxy (CSRF, headers, requestId) -> API route -> Prisma -> Database
                                                              -> logActivity -> ActivityLog
                                                              -> Supabase Storage (images, prod)
```

### Public read path
1. Browser loads `/` (cached HTML)
2. `page.tsx` fetches `/api/site-data` (cached 60s at CDN, SWR 300s)
3. Sections render from Zustand store

### Admin write path
1. User authenticates via `/api/auth/login` (sets httpOnly cookie)
2. mutations call API routes with Origin header (CSRF check)
3. `requireAdmin()` validates session + role on every request
4. `logActivity()` records the action
5. Store updates optimistically, reverts on error

## Database Schema

### Dev (SQLite)
- `schema.prisma` - 7 models with cuid() IDs

### Production (PostgreSQL/Supabase)
- `schema.prod.prisma` - same models with @db.Text, snake_case @map, desc indexes
- `supabase/migrations/` - raw SQL with RLS policies, storage buckets, triggers

### Models
| Model | Purpose |
|-------|---------|
| Announcement | News posts (award, recognition, report, general) |
| AdminYear | Leadership year (e.g. "2024-2025") with theme |
| Officer | Officer in a year (name, role, photo) |
| ContactMessage | Public contact form submissions |
| AdminUser | Admin account (email, scrypt password hash, role) |
| AdminSession | Session row (id, userId, expiresAt) |
| ActivityLog | Audit trail (userId, action, entity, summary) |

## Authentication

Custom session-based auth (not Supabase Auth, not NextAuth):

1. **Login**: POST `/api/auth/login` with email+password
   - Rate limited: 5/min per IP, 10/hour per email
   - scrypt verification (async, non-blocking)
   - Enumeration-resistant: same 401 for wrong user/password/non-admin
   - Creates `AdminSession` row, sets httpOnly cookie (8h TTL)
   - Max 5 sessions per user (oldest evicted)

2. **Every request**: `getCurrentUser()` reads cookie -> finds session -> returns user
   - Expired sessions are deleted on access

3. **Logout**: POST `/api/auth/logout` destroys session + cookie

4. **Password change**: POST `/api/auth/change-password`
   - Requires current password
   - Rotates current session ID
   - Revokes all other sessions

## Caching Strategy

| Endpoint | Cache Header | Rationale |
|----------|-------------|-----------|
| `GET /api/site-data` | `public, s-maxage=60, SWR=300` (dynamic, CDN-cached) | Public, read-heavy; `force-dynamic` so it never prerenders at build time (DB unreachable during Vercel build) |
| `GET /api/announcements` | `public, s-maxage=60, SWR=300` | Public, read-heavy |
| `GET /api/admin-years` | `public, s-maxage=60, SWR=300` | Public, read-heavy |
| `GET /api/auth/session` | `no-store` | Per-user, sensitive |
| `GET /api/contact` | `no-store` | Admin-only, PII |
| `GET /api/sessions` | `no-store` | Per-user, sensitive |
| `GET /api/activity` | `no-store` | Admin-only |
| `GET /api/health` | `no-store` | Must reflect current state |
| Static assets | `immutable, max-age=31536000` | Content-hashed |

## Image Pipeline

1. Admin uploads file via `/api/upload`
2. `sharp` resizes to max 1200x1200, converts to WebP q80
3. Magic bytes verified (defense-in-depth)
4. Production: uploaded to Supabase Storage bucket
5. Dev: written to `public/uploads/`
6. Public URL returned and stored in the database

## Trade-offs

- **Two Prisma schemas**: Prisma's `provider` field must be a literal, so dev uses SQLite and prod uses PostgreSQL. Trade-off: maintenance cost for consistency. See ADR 0002.
- **Custom auth vs Supabase Auth**: Custom gives full control over session management and rate limiting. Trade-off: no built-in MFA, password reset, or breach checks. See ADR 0001.
- **In-memory rate limiter**: Simple, no external dependency. Trade-off: doesn't work across multiple instances (production should use Redis/Upstash).
- **CSP with unsafe-inline**: Next.js requires inline scripts. Trade-off: nonce-based CSP is more secure but requires per-request nonce injection.
- **Lazy-loaded sections**: Reduces initial bundle. Trade-off: section transitions have a brief loading state; SSR is off so crawlers see a shell.

## Deployment Architecture

### Build pipeline

```
.zscripts/build.sh
  -> bun install
  -> bun run build (next build, output: standalone)
  -> guard: verify .next/standalone/server.js exists (self-heal if missing)
  -> collect: standalone + static + public + Caddyfile + start.sh
  -> package: tarball
```

### Runtime topology

```
Internet -> Caddy (:81) -> Next.js standalone (:3000)
                            -> Prisma -> Postgres (external)
                            -> Supabase Storage (images, prod)
```

- **Caddy** terminates TLS, sets security headers (defense-in-depth alongside `src/proxy.ts`), and proxies to Next.js. Runs as PID 1 so it receives SIGTERM from the process manager.
- **Next.js standalone** is a self-contained server (no node_modules needed at runtime except bun). `instrumentation.ts` validates env vars at boot and fails fast on misconfiguration.
- **Database** is external (PostgreSQL in prod). The dev SQLite DB is never bundled into the build artifact (C3 fix).
- **Health check**: `GET /api/health` returns `{ status, checks: { app, db } }` with 200 (healthy) or 503 (degraded). Rate-limited per IP to prevent DoS.

### Environment variables

See `.env.example`. Required: `DATABASE_URL`. Production also requires the three Supabase vars. `instrumentation.ts` validates these at boot.

## Observability

Per 02-system-design.md section 8.

- **Logs**: structured JSON (`src/lib/logger.ts`) with request-scoped context via AsyncLocalStorage. Levels: debug (dev only), info, warn, error. Failed logins log a masked email (`a***@example.com`); the full email goes to the access-controlled audit trail only.
- **Audit trail**: `ActivityLog` table records every privileged action (login, create, update, delete) with userId, action, entity, and summary. Visible to admins via `/api/activity`.
- **Health**: `GET /api/health` for liveness + readiness probes.
- **Gaps (tech debt)**: no metrics/tracing (no OpenTelemetry); no alerting wired on auth-failure or 5xx spikes (06 A09). Documented in `docs/activity-log.md`.
