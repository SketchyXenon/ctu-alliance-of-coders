// App-startup hook. Next.js runs this once when the server boots, before any
// request is handled. We use it to validate environment variables fail-fast
// per 03-software-engineering.md section 6 and 06-security-architecture.md
// section 8 (M1 fix): previously getEnv() was only called by isProduction(),
// so a missing DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY failed late with a
// leaky Prisma connection error instead of a clear boot-time message.
//
// This runs in the Node.js runtime only (not Edge), which is fine because
// env validation is a server-side concern.

export async function register() {
  // Only validate on the server (not during build). The "nodejs" check
  // prevents running during the static build phase.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./src/lib/env");
    try {
      getEnv();
    } catch (e) {
      // Fail fast: print a clear message and exit. In dev this surfaces
      // immediately; in prod the process manager restarts and logs the error.
      console.error("FATAL: environment validation failed at boot:", e instanceof Error ? e.message : e);
      process.exit(1);
    }
  }
}
