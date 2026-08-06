# Alliance of Coders

The official website for the Alliance of Coders at Cebu Technological University - Danao Campus. Built with Next.js 16, TypeScript, Prisma 7, and shadcn/ui.

## Features

- **Public**: Hero landing, announcements feed (with specialized links), officers org chart, contact form, FAQ, policy pages
- **Admin**: Dashboard with inbox (email reply via SMTP), officer management (inline edit + photo upload), announcements CRUD (with links), activity log, session management, integrations panel (functional webhook + configurable Discord/Google/Facebook)
- **Security**: Session-based auth with scrypt hashing, CSRF protection, rate limiting, CSP headers, 9-layer upload defense, enumeration-safe login, HMAC-signed webhook, email header-injection defense, fail-closed error handling
- **Performance**: ISR caching on public endpoints, image compression (sharp -> WebP), lazy-loaded sections
- **UX**: Command palette (Cmd+K), keyboard shortcuts, dark mode, responsive design, print styles, AlertDialog confirmations on destructive actions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Database | SQLite (dev) / PostgreSQL via Supabase (prod) |
| ORM | Prisma 7 (adapter pattern: better-sqlite3 dev, pg prod) |
| UI | shadcn/ui (New York), Tailwind CSS 4, Lucide icons, Framer Motion |
| Auth | Custom session-based (scrypt, httpOnly cookies, 8h TTL, max 5 sessions) |
| Storage | Supabase Storage (prod) / local filesystem (dev) |
| Email | Nodemailer via Gmail SMTP (admin reply-to-contact + test email) |
| Fonts | Space Grotesk (display), IBM Plex Sans (body) |

## Quick Start

```bash
# Install dependencies
bun install

# Copy env file and set DATABASE_URL
cp .env.example .env

# Push database schema (SQLite dev)
bun run db:push:sqlite

# Seed initial data (announcements, officers, years)
bun run db:seed

# Create your first admin account
bun run bootstrap

# Start dev server
bun run dev
```

Open `http://localhost:3000` in your browser.

## Environment Variables

See [`.env.example`](./.env.example) for all variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path (dev) or Supabase pooler URL (prod, port 6543) |
| `DIRECT_URL` | Prod | Supabase session-mode pooler (port 5432) for `prisma db push` / `migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod | Supabase service role key (server-only, bypasses RLS) |
| `SMTP_HOST` | Optional | Gmail SMTP host (e.g. smtp.gmail.com) for inbox reply |
| `SMTP_PORT` | Optional | 587 (STARTTLS) or 465 (TLS) |
| `SMTP_USER` | Optional | Gmail/Workspace address |
| `SMTP_PASS` | Optional | Google App Password (NOT the account password) |
| `SMTP_FROM_NAME` | Optional | Display name (default: "Alliance of Coders") |
| `SMTP_FROM_EMAIL` | Optional | From address (default: SMTP_USER) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Canonical site URL for SEO/OG tags |
| `NEXT_PUBLIC_FACEBOOK_URL` | Optional | Footer Facebook link |
| `NEXT_PUBLIC_GITHUB_URL` | Optional | Footer GitHub link |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional | Footer email link |

## Scripts

| Script | Description |
|--------|------------|
| `bun run dev` | Start dev server (port 3000, Turbopack) |
| `bun run build` | Production build (standalone output) |
| `bun run start` | Start production server (standalone) |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Run TypeScript type checking (tsc --noEmit) |
| `bun run test` | Run vitest test suite (371 tests) |
| `bun run db:push` | Push schema to database (uses prisma.config.ts) |
| `bun run db:push:sqlite` | Push schema to dev SQLite database |
| `bun run db:seed` | Seed initial data |
| `bun run bootstrap` | Create first admin account (interactive prompt) |

## Deployment

### Option A: Standalone server (sandbox / VM / container)

The app builds to a self-contained standalone server via `.zscripts/build.sh`.

1. Set required environment variables (see `.env.example`).
2. For Supabase prod: set `DATABASE_URL` (pooler port 6543) + `DIRECT_URL` (session pooler port 5432).
3. Run `bun run db:push` to create the schema (uses DIRECT_URL for DDL).
4. Run `bun run bootstrap` to create the first admin account.
5. Build: `BUILD_ID=<id> bash .zscripts/build.sh`.
6. Start: `./start.sh` (launches Next.js + Caddy).

### Option B: Vercel

1. Push to GitHub.
2. Import the project in Vercel.
3. Set environment variables. `DATABASE_URL` = pooler (port 6543), `DIRECT_URL` = session pooler (port 5432).
4. Apply the Supabase schema by running the SQL migrations in `supabase/migrations/` against your Supabase Postgres (via the Supabase dashboard SQL Editor, in order). These are the single source of truth for the prod schema. Then run `bun run db:push` to sync Prisma's client with the applied schema.
5. Run `bun run bootstrap` (locally with prod env) to create the admin account.
6. Deploy.

Bot protection is handled by Vercel Firewall (edge). Configure bot rules in the Vercel dashboard > Project > Security > Firewall. No Cloudflare Turnstile or client-side gate is needed.

See [docs/deployment.md](./docs/deployment.md) for the full deployment runbook.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) - System design, data flow, trade-offs
- [Security](./docs/SECURITY.md) - OWASP alignment, threat model, hardening
- [API Reference](./docs/API.md) - All endpoints with examples
- [Deployment](./docs/deployment.md) - Deployment runbook (standalone, Docker, Vercel)
- [Activity Log](./docs/activity-log.md) - Major decisions and changes
- [ADRs](./docs/adr/) - Architecture Decision Records

## License

MIT - see [LICENSE](./LICENSE)
