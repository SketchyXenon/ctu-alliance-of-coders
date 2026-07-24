# Alliance of Coders

The official website for the Alliance of Coders at Cebu Technological University - Danao Campus. Built with Next.js 16, TypeScript, Prisma, and shadcn/ui.

## Features

- **Public**: Hero landing, announcements feed, officers org chart, contact form, policy pages
- **Admin**: Dashboard with inbox, officer management, activity log, session management
- **Security**: Session-based auth with scrypt hashing, CSRF protection, rate limiting, CSP headers, RLS-ready Supabase schema
- **Performance**: ISR caching on public endpoints, image compression (sharp -> WebP), lazy-loaded sections
- **UX**: Command palette (Cmd+K), keyboard shortcuts, dark mode, responsive design, print styles

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Database | SQLite (dev) / PostgreSQL via Supabase (prod) |
| ORM | Prisma 6 |
| UI | shadcn/ui (New York), Tailwind CSS 4, Lucide icons |
| Auth | Custom session-based (scrypt, httpOnly cookies) |
| Storage | Supabase Storage (prod) / local filesystem (dev) |
| Fonts | Space Grotesk (display), IBM Plex Sans (body) |

## Quick Start

```bash
# Install dependencies
bun install

# Copy env file and set DATABASE_URL
cp .env.example .env

# Push database schema
bun run db:push

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
| `DATABASE_URL` | Yes | SQLite path (dev) or PostgreSQL URL (prod) |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod only | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod only | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod only | Supabase service role key (server-only) |
| `NEXT_PUBLIC_FACEBOOK_URL` | No | Footer Facebook link |
| `NEXT_PUBLIC_GITHUB_URL` | No | Footer GitHub link |
| `NEXT_PUBLIC_CONTACT_EMAIL` | No | Footer email link |

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start dev server (port 3000, Turbopack) |
| `bun run build` | Production build (standalone output) |
| `bun run start` | Start production server (standalone) |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Run TypeScript type checking (tsc --noEmit) |
| `bun run test` | Run vitest test suite |
| `bun run db:push` | Push schema to dev database (SQLite) |
| `bun run db:push:prod` | Push schema to production (PostgreSQL) |
| `bun run db:migrate:prod` | Apply production migrations (migrate deploy) |
| `bun run db:seed` | Seed initial data |
| `bun run bootstrap` | Create first admin account |

## Deployment

### Option A: Standalone server (sandbox / VM / container)

The app builds to a self-contained standalone server via `.zscripts/build.sh`.

1. Set required environment variables (see `.env.example`) — `DATABASE_URL` is mandatory.
2. Build: `BUILD_ID=<id> bash .zscripts/build.sh` — produces a tarball with the standalone server, static assets, Caddyfile, and start.sh.
3. Extract the tarball on the target host.
4. Run `bun run db:migrate:prod` to apply the production schema (PostgreSQL).
5. Run `bun run bootstrap` to create the first admin account (interactive prompt).
6. Start: `./start.sh` — launches Next.js + Caddy (Caddy runs as PID 1).

Caddy listens on `:81` and proxies to Next.js on `:3000`. See `Caddyfile` for the gateway config and security headers.

### Option B: Vercel

1. Push to GitHub.
2. Import the project in Vercel.
3. Set environment variables (see above). `DATABASE_URL` must point to Postgres.
4. Run `bun run db:migrate:prod` against your Postgres instance to create tables.
5. Run `bun run bootstrap` to create the admin account (run locally with prod env).
6. Deploy.

See [docs/deployment.md](./docs/deployment.md) for the full deployment runbook.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) - System design, data flow, trade-offs
- [Security](./docs/SECURITY.md) - OWASP alignment, threat model, hardening
- [API Reference](./docs/API.md) - All endpoints with examples

## License

MIT - see [LICENSE](./LICENSE)
