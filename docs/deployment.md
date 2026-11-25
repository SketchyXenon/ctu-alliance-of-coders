# Deployment Runbook

Per 02-system-design.md section 6 (reliability) and 06-security-architecture.md
section 11 (incident response). No emojis (Z.md).

## Prerequisites

- **Runtime**: bun 1.3+ (or Node 20+)
- **Database**: PostgreSQL 14+ (Supabase recommended for prod; SQLite for dev only)
- **Gateway**: Caddy 2.8+ (bundled in the standalone tarball)
- **Image storage**: Supabase Storage bucket (production only)

## Environment variables

See `.env.example`. Required for production:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL POOLED connection (Supabase pooler port 6543) for app runtime |
| `DIRECT_URL` | Yes (prod) | PostgreSQL DIRECT connection (port 5432) for `prisma db push` / `migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (prod) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (prod) | Supabase anon key (client-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (prod) | Server-only; never prefixed with NEXT_PUBLIC_ |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Canonical site URL for SEO/OG |
| `CSRF_ALLOWED_ORIGINS` | Optional | Comma-separated extra CSRF origins (staging) |
| `IMG_ALLOWED_HOSTS` | Optional | Comma-separated extra CSP image hosts |

`instrumentation.ts` validates these at boot and fails fast on misconfiguration.

### Supabase database connection (important)

Supabase provides THREE connection endpoints. You need TWO of them in production:

1. **`DATABASE_URL`** — the **transaction mode pooler** (port 6543, host
   `aws-<region>.pooler.supabase.com`). Used by the app runtime (PrismaClient
   adapter). IPv4-accessible. PgBouncer pools connections so serverless
   functions don't exhaust the Postgres connection pool. Append
   `?pgbouncer=true` to the URL. Does NOT support DDL.

2. **`DIRECT_URL`** — the **session mode pooler** (port 5432, SAME pooler
   host `aws-<region>.pooler.supabase.com`). Used by `prisma db push` and
   `prisma migrate` for DDL and schema introspection. IPv4-accessible.
   PgBouncer session mode supports DDL (unlike transaction mode).

3. **Direct connection** (`db.<project-ref>.supabase.co:5432`) — **DO NOT USE.**
   This endpoint is IPv6-only since 2024. Most IPv4 networks (including
   Windows dev machines and many cloud providers) cannot reach it, causing
   `P1001: Can't reach database server` errors. Supabase provides it for
   legacy compatibility only.

**Why session pooler for DIRECT_URL?** Prisma's migration engine does not work
through PgBouncer transaction pooling (port 6543) — `prisma db push` would
hang. The session mode pooler (port 5432) gives a dedicated backend connection
per session, which supports DDL. It's also IPv4-accessible, unlike the direct
endpoint. Per 02-system-design.md section 6: "Timeouts on every external call
— no unbounded waits."

**Username format**: both pooler URLs use `postgres.<project-ref>` as the
username (not just `postgres`). Example: `postgres.shgnqojwqrrezvysfudh`.

Example `.env` for production:

```
DATABASE_URL="postgresql://postgres.shgnqojwqrrezvysfudh:PASS@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.shgnqojwqrrezvysfudh:PASS@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```

Note: both URLs use the SAME pooler host — only the port differs (6543 for
runtime, 5432 for migrations).

For SQLite dev: leave `DIRECT_URL` unset — Prisma falls back to `DATABASE_URL`.

## Option A: Standalone tarball (sandbox / VM)

### Build

```bash
BUILD_ID=$(date +%s) bash .zscripts/build.sh
```

Produces `/tmp/build_fullstack_<BUILD_ID>.tar.gz` containing:
- `next-service-dist/` - standalone Next.js server + static assets + public
- `Caddyfile` - gateway config
- `start.sh` - entrypoint

### Deploy

1. Copy the tarball to the target host.
2. Extract: `tar -xzf build_fullstack_<BUILD_ID>.tar.gz -C /app`
3. Set environment variables (export or via systemd/Docker env).
4. Apply the production schema:
   ```bash
   DATABASE_URL=postgresql://... bun run db:migrate:prod
   ```
5. Create the first admin (interactive prompt, password is hidden):
   ```bash
   DATABASE_URL=postgresql://... bun run bootstrap
   ```
6. Start: `cd /app && ./start.sh`

### Verify

- `curl http://localhost:81/api/health` returns `{"status":"healthy",...}`
- `curl -I http://localhost:81/` returns 200 with security headers (CSP, HSTS, X-Frame-Options)

## Option B: Docker container

```bash
# Build the image
docker build -t allianceofcoders:latest .

# Run with env vars
docker run -d \
  --name aoc \
  -p 81:81 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  allianceofcoders:latest

# Apply schema (run once against the same DB)
docker exec aoc bun run db:migrate:prod

# Create admin (interactive)
docker exec -it aoc bun run bootstrap
```

The container includes a HEALTHCHECK on `/api/health`. Check with:
```bash
docker inspect --format='{{.State.Health.Status}}' aoc
```

## Option C: Vercel

1. Push to GitHub.
2. Import in Vercel.
3. Set all environment variables (see table above).
4. Vercel builds with `bun run build` automatically.
5. Apply the production schema from a local shell with prod env:
   ```bash
   DATABASE_URL=postgresql://... bun run db:migrate:prod
   ```
6. Create the admin account locally with prod env:
   ```bash
   DATABASE_URL=postgresql://... bun run bootstrap
   ```

Note: Vercel does not use Caddy; `src/proxy.ts` handles security headers and
CSRF on its own. The `Caddyfile` is ignored on Vercel.

## Health checks

- **Liveness + readiness**: `GET /api/health` returns 200 with
  `{"status":"healthy","checks":{"app":"ok","db":"ok"}}` or 503 if the DB is
  unreachable. Rate-limited per IP (60/min) to prevent DoS.
- Configure your load balancer / orchestrator to poll this endpoint every 30s.

## Graceful shutdown

`start.sh` traps SIGTERM/SIGINT and:
1. Sends SIGTERM to Next.js and mini-services.
2. Waits up to 5 seconds.
3. Force-kills any remaining processes.
4. Exits 0.

Caddy runs as PID 1 (via `exec`), so container orchestrators (Docker, K8s)
signal it directly.

## Rollback

The build produces a tarball per `BUILD_ID`. To roll back:
1. Keep the previous tarball.
2. Stop the current service: `docker stop aoc` (Docker) or
   `pkill -f 'caddy run'; pkill -f 'next-service-dist/server.js'` (tarball/VM).
   Note: start.sh does not write a PID file; Caddy is PID 1 and is signaled
   directly by the process manager.
3. Extract the previous tarball and restart.

There is no database rollback automation. Prisma migrations are forward-only;
if a migration breaks something, use `prisma migrate resolve` to mark it rolled
back, then restore from a DB snapshot.

## Incident response

Per 06-security-architecture.md section 11.

1. **Identify**: check `GET /api/health` (is the DB up?), check logs
   (`/api/activity` for admin actions, structured JSON logs for errors).
2. **Contain**: if compromised, revoke all sessions via the admin panel
   (Sessions tab) or by truncating the `AdminSession` table.
3. **Rotate**: if admin credentials are compromised, change the password
   (auto-rotates the session + revokes all others). If the Supabase service
   key is compromised, rotate it in the Supabase dashboard and update env vars.
4. **Investigate**: the `ActivityLog` table records every privileged action
   with userId, timestamp, and summary.
5. **Communicate**: notify the admin team; document the incident in
   `docs/activity-log.md`.

## Known limitations (tech debt)

- **In-memory rate limiter**: per-instance only. Multi-instance prod needs
  Redis/Upstash. See ADR 0001.
- **No MFA**: admin login is single-factor. See ADR 0001.
- **No alerting**: auth failures and 5xx spikes are logged but not alerted on
  (06 A09). Wire up an APM (Sentry, Datadog) before high-traffic launch.
- **No metrics/tracing**: no OpenTelemetry. Add before scaling.
