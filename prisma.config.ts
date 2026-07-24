// Prisma config file.
// Keep this runtime-free so Prisma can load it even when the dependency tree
// has not been installed yet. The CLI only needs a plain object here.
//
// This config defaults to the PostgreSQL production schema (schema.prisma).
// For local SQLite dev, set DATABASE_URL=file:./db/custom.db and the
// PRISMA_SCHEMA env var to prisma/schema.sqlite.prisma (or run the
// db:push:sqlite script which sets both).
//
// Per 03-software-engineering.md section 6: fail fast with a clear message.

import path from "node:path";

// Select schema based on DATABASE_URL scheme or PRISMA_SCHEMA override.
// - file:*           -> SQLite dev schema
// - postgresql://    -> Postgres prod schema
function resolveSchema(): string {
  const override = process.env.PRISMA_SCHEMA;
  if (override) return override;

  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.startsWith("file:")) {
    return path.join("prisma", "schema.sqlite.prisma");
  }
  // Default to Postgres for production (postgresql://, postgres://).
  return path.join("prisma", "schema.prisma");
}

const config = {
  schema: resolveSchema(),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // Prisma 7: pass the datasource URL here for CLI commands (db push, migrate).
  // The runtime adapter is configured separately in src/lib/db.ts.
  datasource: {
    url: process.env.DATABASE_URL,
  },
};

export default config;
