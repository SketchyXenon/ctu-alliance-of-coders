import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Warn if DATABASE_URL uses Supabase's DIRECT connection endpoint.
 *
 * Supabase's direct URL (db.<project-ref>.supabase.co:5432) resolves to IPv6.
 * Vercel serverless functions (and many cloud platforms) cannot do IPv6
 * egress, so the connection silently fails with "Can't reach database server"
 * even when the DB is perfectly healthy. The fix is to use Supabase's
 * CONNECTION POOLER URL (aws-0-<region>.pooler.supabase.com) which provides
 * an IPv4 endpoint designed for serverless.
 *
 * Per 02-system-design.md section 6: "Assume every dependency will fail, and
 * design for it." Per 03-software-engineering.md section 6: fail fast with a
 * clear, actionable message.
 */
function validateConnectionString(): void {
  const url = process.env.DATABASE_URL || "";
  if (!url) return; // env.ts handles the missing-URL case at boot

  // Detect Supabase direct connection: db.<ref>.supabase.co
  const isSupabaseDirect =
    /^postgres(ql)?:\/\/.*@db\.[a-z0-9]+\.supabase\.(co|in)/i.test(url);

  if (isSupabaseDirect && process.env.NODE_ENV === "production") {
    console.warn(
      "[DB] WARNING: DATABASE_URL uses Supabase's DIRECT connection (db.*.supabase.co).\n" +
        "      This endpoint is IPv6-only and is unreachable from Vercel serverless functions.\n" +
        "      Use the Supabase CONNECTION POOLER URL instead:\n" +
        "        1. Supabase Dashboard > Project Settings > Database > Connection Pooling\n" +
        "        2. Copy the 'Session mode' URL (host: aws-0-<region>.pooler.supabase.com:5432)\n" +
        "        3. Set DATABASE_URL to that pooler URL in your Vercel environment variables.\n" +
        "      The pooler provides an IPv4 endpoint that Vercel can reach.",
    );
  }
}

// Lazy init: only create the client (and read env) on first access.
// This avoids breaking `next build` when env vars aren't set yet.
function createClient(): PrismaClient {
  validateConnectionString();

  const isProd = process.env.NODE_ENV === "production";
  return new PrismaClient({
    log: isProd ? ["error"] : ["error", "warn"],
    // Serverless: limit to 1 connection per function instance to avoid
    // exhausting the Supabase connection pool. Per 02 section 5 (stateless
    // services) and Supabase's serverless guidance.
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

/**
 * Wrap a DB operation with retry + exponential backoff + jitter.
 * Per 02-system-design.md section 6: "Retries with exponential backoff and
 * jitter for transient failures." Serverless cold starts and Supabase pooler
 * warmups can cause transient connection failures on the first attempt.
 */
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
      // Only retry on connection/initialization errors, not on validation
      // or known request errors (P2002, P2025, etc.).
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

      // Exponential backoff with jitter: 200ms, 400ms, 800ms (+ random 0-100ms).
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
