# Architecture

## Overview

Single-page application with section-based navigation. All user-facing content
serves from `/` with client-side routing between sections. API routes handle
data operations with server-side authorization.

```
src/
  app/
    api/            - Route handlers (21+ endpoints)
    layout.tsx      - Root layout (fonts, theme, metadata, JSON-LD)
    page.tsx        - Main page (section router, state)
    globals.css     - Design tokens, utilities
    sitemap.ts      - Dynamic sitemap
    robots.ts       - Dynamic robots.txt (disallows /api/)
    opengraph-image.tsx - Dynamic OG image
  components/
    sections/       - Page sections (hero, announcements, officers, contact, admin, policy, faq)
    admin/          - Admin sub-components (login, inbox, officers-manager, activity, sessions, settings, integrations)
    ui/             - shadcn/ui primitives
    gear-logo.tsx   - Brand logo
    site-nav.tsx    - Sticky navigation
    site-footer.tsx - Footer
    ...             - Shared components (back-to-top, command-palette, etc.)
  hooks/            - Custom hooks (keyboard shortcuts, count-up, parallax, command palette)
  lib/              - Server utilities (auth, db, security, logger, email, upload, supabase, announcements, env, store)
  proxy.ts        - CSRF + security headers + request ID (Next 16 renamed middleware to proxy)
prisma/
  schema.prisma         - Production schema (PostgreSQL, @db.Uuid + @map)
  schema.sqlite.prisma  - Dev schema (SQLite)
  seed.ts               - Initial data
supabase/
  migrations/       - SQL migration (profiles cleanup + storage buckets)
scripts/
  bootstrap-admin.ts - First admin account creation
public/
  uploads/          - Dev image storage (gitignored)
  llms.txt          - LLM crawler guide
  ai.txt            - AI scraper policy
  .well-known/      - security.txt (responsible disclosure)
```

## Data Flow

```
Browser -> proxy (CSRF, headers, requestId) -> API route -> Prisma -> Database
                                                              -> logActivity -> ActivityLog
                                                              -> Supabase Storage (images, prod)
                                                              -> SMTP (email reply, prod)
```

### Public read path
1. Browser loads `/` (cached HTML)
2. `page.tsx` fetches `/api/site-data` (cached 60s at CDN, SWR 300s)
3. Sections render from Zustand store

### Admin write path
1. User authenticates via `/api/auth/login` (sets httpOnly cookie)
2. Mutations call API routes with Origin header (CSRF check)
3. `requireAdmin()` validates session + role on every request
4. `logActivity()` records the action
5. Store updates optimistically, reverts on error

## Database Schema

### Dev (SQLite)
- `schema.sqlite.prisma` - 7 models with cuid() IDs

### Production (PostgreSQL/Supabase)
- `schema.prisma` - same models with @db.Uuid, @db.Text, snake_case @map, desc indexes
- `supabase/migrations/` - raw SQL with storage buckets (profiles + RLS cleaned up in 20260725000000 migration)

### Prisma 7 Adapter Pattern
Prisma 7 requires a driver adapter at construction time (no more `datasource.url` in the schema):
- `src/lib/db.ts` - runtime adapter selection (better-sqlite3 for dev, pg for prod)
- `prisma.config.ts` - CLI config (prefers `DIRECT_URL` for `db push` / `migrate`, falls back to `DATABASE_URL`)

### Supabase Connection
Supabase provides three endpoints. The app uses two:
- `DATABASE_URL` = transaction pooler (port 6543) for runtime queries
- `DIRECT_URL` = session pooler (port 5432) for migrations (DDL)
- The direct endpoint (`db.<ref>.supabase.co:5432`) is IPv6-only and should NOT be used

### Models
| Model | Purpose |
|-------|---------|
| Announcement | News posts (type, title, body, image, links[], pinned, date) |
| AdminYear | Leadership year (e.g. "2024-2025") with theme |
| Officer | Officer in a year (name, role, photo, sortOrder) |
| ContactMessage | Public contact form submissions (clientId for idempotency) |
| AdminUser | Admin account (email, scrypt password hash, role) |
| AdminSession | Session row (id, userId, expiresAt) — UUID in prod |
| ActivityLog | Audit trail (userId, action, entity, summary) |

## Authentication

Custom session-based auth (not Supabase Auth, not NextAuth):

1. **Login**: POST `/api/auth/login` with email+password
   - Rate limited: 5/min per IP, 10/hour per email (unified 429 message)
   - scrypt verification (async, non-blocking)
   - Enumeration-resistant: DUMMY_HASH + same 401 for wrong user/password/non-admin
   - Creates `AdminSession` row, sets httpOnly cookie (8h TTL)
   - Max 5 sessions per user (oldest evicted, transactional)

2. **Every request**: `getCurrentUser()` reads cookie -> finds session -> returns user
   - Fails closed on DB errors (returns null = logged out)
   - Expired sessions are deleted on access

3. **Logout**: POST `/api/auth/logout` destroys session + cookie

4. **Password change**: POST `/api/auth/change-password`
   - Requires current password
   - Rotates current session ID (transactional, TOCTOU-safe)
   - Revokes all other sessions

## Caching Strategy

| Endpoint | Cache Header | Rationale |
|----------|-------------|-----------|
| `GET /api/site-data` | `public, s-maxage=60, SWR=300` (dynamic, CDN-cached) | Public, read-heavy; `force-dynamic` so it never prerenders at build time |
| `GET /api/announcements` | `public, s-maxage=60, SWR=300` | Public, read-heavy |
| `GET /api/admin-years` | `public, s-maxage=60, SWR=300` | Public, read-heavy |
| `GET /api/auth/session` | `no-store` | Per-user, sensitive |
| `GET /api/contact` | `no-store` | Admin-only, PII |
| `GET /api/sessions` | `no-store` | Per-user, sensitive |
| `GET /api/activity` | `no-store` | Admin-only |
| `GET /api/health` | `no-store` | Must reflect current state |
| Static assets | `immutable, max-age=31536000` | Content-hashed |

## Image Pipeline (9-layer defense)

1. Admin uploads file via `/api/upload`
2. **Layer 1**: Admin-only (requireAdmin)
3. **Layer 2**: Rate-limited (10/min per admin)
4. **Layer 3**: CSRF check (proxy.ts)
5. **Layer 4**: Max file size (8MB, Content-Length pre-check + post-parse)
6. **Layer 5**: Magic-byte detection via `file-type` (not Content-Type)
7. **Layer 6**: Allowlist (JPEG/PNG/WebP only)
8. **Layer 7**: Sharp re-encode to WebP (strips EXIF + embedded payloads — the malware defense)
9. **Layer 8**: Server-generated filename (crypto.randomUUID, no user input in path)
10. **Layer 9**: Dimension cap (max 2000x2000, `limitInputPixels` = 4M)
11. Storage: Supabase Storage (prod) or local `public/uploads/` (dev)
12. Public URL returned and stored in the database

## Email Pipeline

1. Admin clicks "Reply" on a contact message
2. `POST /api/contact/[id]/reply` with replyBody + optional subject
3. `src/lib/email.ts` builds a plain-text email (no HTML XSS surface) with quoted original
4. Nodemailer sends via Gmail SMTP (Google App Password required)
5. On success: message marked "resolved", audit logged
6. On failure: 502 with mapped user-friendly error (no internal details leaked)

## Announcement Links

- Links stored as JSON-encoded array of `{url, label}` in a single `links` String column
- Max 10 links per announcement
- URLs restricted to http/https (rejects javascript:, data:, file:)
- Label defaults to hostname if empty
- Validated client-side + server-side (defense in depth)

## Trade-offs

- **Two Prisma schemas**: Prisma's `provider` field must be a literal, so dev uses SQLite and prod uses PostgreSQL. Trade-off: maintenance cost for consistency. See ADR 0002.
- **Custom auth vs Supabase Auth**: Custom gives full control over session management and rate limiting. Trade-off: no built-in MFA, password reset, or breach checks. See ADR 0001.
- **In-memory rate limiter**: Simple, no external dependency. Trade-off: doesn't work across multiple instances (production should use Redis/Upstash).
- **CSP with unsafe-inline**: Next.js requires inline scripts. Trade-off: nonce-based CSP is more secure but requires per-request nonce injection.
- **Lazy-loaded sections**: Reduces initial bundle. Trade-off: section transitions have a brief loading state; SSR is off so crawlers see a shell.
- **Links as JSON column**: Simpler than a separate table (no joins). Trade-off: harder to query by link URL. Acceptable for max-10-links-per-announcement.
- **Plain-text email only**: No HTML formatting. Trade-off: universally deliverable, no XSS surface.

## Deployment Architecture

### Build pipeline

```
.zscripts/build.sh
  -> bun install
  -> bun run build (next build, output: standalone)
  -> guard: verify .next/standalone/server.js exists
  -> collect: standalone + static + public + Caddyfile + start.sh
  -> package: tarball
```

### Runtime topology

```
Internet -> Caddy (:81) -> Next.js standalone (:3000)
                            -> Prisma -> Postgres (Supabase pooler, port 6543)
                            -> Supabase Storage (images, prod)
                            -> Gmail SMTP (email reply, prod)
```

- **Caddy** terminates TLS, sets security headers, and proxies to Next.js. Runs as PID 1.
- **Next.js standalone** is self-contained. `instrumentation.ts` validates env vars at boot.
- **Database** is external. The dev SQLite DB is never bundled into the build artifact.
- **Health check**: `GET /api/health` returns `{ status, checks: { app, db } }`. Rate-limited per IP.

### Environment variables

See `.env.example`. Required: `DATABASE_URL`. Production also requires Supabase vars + `DIRECT_URL` for migrations. SMTP vars optional (for inbox reply). `instrumentation.ts` + `src/lib/env.ts` validate these at boot.

## Observability

Per 02-system-design.md section 8.

- **Logs**: structured JSON (`src/lib/logger.ts`) with request-scoped context via AsyncLocalStorage. Levels: debug (dev only), info, warn, error. Failed logins log a masked email (`a***@example.com`); the full email goes to the access-controlled audit trail only. SMTP errors logged server-side; only mapped friendly messages reach the client.
- **Audit trail**: `ActivityLog` table records every privileged action (login, logout, create, update, delete, reply, upload, test email) with userId, action, entity, and summary. Visible to admins via `/api/activity`.
- **Health**: `GET /api/health` for liveness + readiness probes.
- **Gaps (tech debt)**: no metrics/tracing (no OpenTelemetry); no alerting wired on auth-failure or 5xx spikes (06 A09). Documented in `docs/activity-log.md`.

## Web Crawling & AI Policy

- `robots.txt` (dynamic, `src/app/robots.ts`): allows all user agents on `/`, disallows `/api/`.
- `llms.txt` (`public/llms.txt`): guides LLM crawlers to the site's public content + policy.
- `ai.txt` (`public/ai.txt`): AI scraper policy (allowed use cases, attribution, rate limits).
- `.well-known/security.txt`: responsible disclosure contact.
