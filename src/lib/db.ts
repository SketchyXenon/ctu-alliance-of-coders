import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

function validateConnectionString(): void {
  const url = process.env.DATABASE_URL || "";
  if (!url) return;

  const isSupabaseDirect =
    /^postgres(ql)?:\/\/.*@db\.[a-z0-9]+\.supabase\.(co|in)/i.test(url);
  const isSessionModePooler =
    /pooler\.supabase\.(com|in)/i.test(url) && /:5432\b/.test(url);

  if (process.env.NODE_ENV === "production") {
    if (isSupabaseDirect) {
      console.warn(
        "[DB] WARNING: DATABASE_URL uses Supabase's DIRECT connection (db.*.supabase.co).\n" +
          "      This endpoint is IPv6-only and unreachable from Vercel serverless.\n" +
          "      Use the TRANSACTION MODE pooler (port 6543) with ?pgbouncer=true.\n" +
          "      See .env.example for the correct URL format.",
      );
    } else if (isSessionModePooler) {
      console.warn(
        "[DB] WARNING: DATABASE_URL uses Session mode pooler (port 5432).\n" +
          "      Switch to Transaction mode (port 6543) for Vercel serverless.",
      );
    }
  }
}

function createClient(): PrismaClient {
  validateConnectionString();

  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. For dev: set DATABASE_URL=file:./db/custom.db. " +
        "For prod: set DATABASE_URL to your Supabase Transaction mode pooler URL.",
    );
  }

  if (url.startsWith("file:")) {
    const adapter = new PrismaBetterSqlite3({ url });
    return new PrismaClient({ adapter });
  }

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    const adapter = new PrismaPg({ connectionString: url });
    return new PrismaClient({ adapter });
  }

  throw new Error(
    `Unsupported DATABASE_URL scheme. Expected "file:" (SQLite) or "postgresql://" (Postgres). Got: ${url.slice(0, 20)}...`,
  );
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 200 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const name = (error as { name?: string })?.name ?? "";
      const msg = (error as { message?: string })?.message ?? "";
      const isTransient =
        name === "PrismaClientInitializationError" ||
        name === "PrismaClientRustPanicError" ||
        name === "PrismaClientUnknownRequestError" ||
        /Can't reach database server|Timed out|connect ECONNREFUSED|ENOTFOUND|read ECONNRESET|socket hang up/i.test(
          msg,
        );

      if (!isTransient || attempt === retries) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

let _db: PrismaClient | null = null;

function getDb(): PrismaClient {
  if (!_db) {
    _db = createClient();
  }
  return _db;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
}) as PrismaClient;
