// Prisma 7 configuration file.
import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "@prisma/config";

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

function resolveSchema(): string {
  const override = process.env.PRISMA_SCHEMA;
  if (override) return override;

  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.startsWith("file:")) {
    return path.join("prisma", "schema.sqlite.prisma");
  }
  return path.join("prisma", "schema.prisma");
}

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
