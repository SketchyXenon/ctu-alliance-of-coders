// Prisma 7 configuration file.
// Per Prisma 7: the datasource URL is no longer in the schema file. It lives
// here (for CLI commands like db push, migrate) and is passed as an adapter
// to PrismaClient (for runtime queries). See src/lib/db.ts for the runtime
// adapter.
//
// This config defaults to the PostgreSQL production schema (schema.prisma).
// For local SQLite dev, set DATABASE_URL=file:./db/custom.db and the
// PRISMA_SCHEMA env var to prisma/schema.sqlite.prisma (or run db:push:sqlite).
//
// SUPABASE / PGBOUNCER: prisma db push and prisma migrate do NOT work through
// PgBouncer transaction pooling (Supabase pooler port 6543). They require a
// direct connection. Set DIRECT_URL to the direct connection string (port 5432)
// in .env. This config prefers DIRECT_URL for CLI commands when set; falls back
// to DATABASE_URL otherwise (SQLite dev, or non-pooled Postgres).
//
// RUNTIME: the app's PrismaClient adapter (src/lib/db.ts) reads DATABASE_URL
// directly, NOT this config. So DATABASE_URL should point at the POOLED
// connection for runtime; DIRECT_URL is used only for CLI migrations.
//
// Per 03-software-engineering.md section 6: fail fast with a clear message.
// Per 02-system-design.md section 6: no unbounded waits (the pooler hang).

import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "@prisma/config";

/**
 * Explicitly load .env from the project root into process.env.
 * The Prisma CLI may run in a context where .env isn't auto-loaded (e.g.,
 * `bunx prisma` on Windows). This ensures DATABASE_URL and DIRECT_URL are
 * available when the config file is evaluated. Per 03 section 6: fail fast.
 */
function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      return;
    }
    dir = path.dirname(dir);
  }
}

loadEnvFile();

// Pre-flight check: warn if DIRECT_URL uses Supabase's IPv6-only direct endpoint.
// The direct endpoint (db.<ref>.supabase.co:5432) is unreachable from most IPv4
// networks, causing P1001 errors on prisma db push / migrate. The session-mode
// pooler (aws-<region>.pooler.supabase.com:5432) is the IPv4-friendly replacement.
// Per 03 section 6: fail fast with a clear message (before the hang).
function warnIfIpv6OnlyDirectUrl(): void {
  const directUrl = process.env.DIRECT_URL || "";
  if (directUrl && /db\.[a-z0-9]+\.supabase\.(co|in)/i.test(directUrl)) {
    console.warn(
      "[prisma.config] WARNING: DIRECT_URL uses db.<ref>.supabase.co (the direct endpoint).\n" +
        "                This endpoint is IPv6-ONLY since 2024. Most IPv4 networks cannot\n" +
        "                reach it — prisma db push will fail with P1001 (Can't reach database).\n" +
        "                Fix: switch to the SESSION MODE POOLER (same host, port 5432):\n" +
        '                  DIRECT_URL="postgresql://postgres.REF:PASS@aws-REGION.pooler.supabase.com:5432/postgres"\n' +
        "                Get it from: Supabase dashboard > Settings > Database > Connection pooling > Session mode\n",
    );
  }
}

warnIfIpv6OnlyDirectUrl();

// Select schema based on DATABASE_URL scheme or PRISMA_SCHEMA override.
function resolveSchema(): string {
  const override = process.env.PRISMA_SCHEMA;
  if (override) return override;

  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.startsWith("file:")) {
    return path.join("prisma", "schema.sqlite.prisma");
  }
  return path.join("prisma", "schema.prisma");
}

// CLI datasource URL: prefer DIRECT_URL (for Supabase/Postgres pooled setups
// where db push/migrate can't go through PgBouncer). Fall back to DATABASE_URL
// for SQLite dev or non-pooled Postgres. Runtime queries do NOT use this value
// (they use DATABASE_URL directly via the adapter in src/lib/db.ts).
const cliDatasourceUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: resolveSchema(),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: cliDatasourceUrl,
  },
});
