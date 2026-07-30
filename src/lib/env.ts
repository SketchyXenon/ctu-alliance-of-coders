// Centralized environment variable validation.
// Per 06-security-architecture.md: secrets in env, validated at startup.
// Per 03-software-engineering.md: fail fast and loud on misconfiguration.
//
// Production requires Supabase for image storage (officer photos +
// announcement images). The upload route (src/lib/upload.ts) uses Supabase
// Storage when configured, falling back to local fs in dev. In prod, the
// Supabase env vars are mandatory so uploads don't silently fall back to
// a local fs that doesn't persist across serverless instances.

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_FACEBOOK_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_GITHUB_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_CONTACT_EMAIL: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Cloudflare Turnstile (bot checkpoint). Optional in dev; in prod, both
  // keys should be set so the bot gate is active. See src/lib/turnstile.ts.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validated env vars. Throws with a clear message on first invalid access.
 * Safe to call at runtime; not called at build time.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${issues}\n\nCheck .env or Vercel settings.`,
    );
  }

  // Production requires Supabase for image storage. Per 03 section 6: fail
  // fast — a prod deploy without Supabase would silently fall back to local
  // fs, which doesn't persist across serverless instances. Better to refuse
  // to start than to silently lose uploads.
  if (parsed.data.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!parsed.data.NEXT_PUBLIC_SUPABASE_URL)
      missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!parsed.data.SUPABASE_SERVICE_ROLE_KEY)
      missing.push("SUPABASE_SERVICE_ROLE_KEY");
    // Turnstile: prod MUST have both keys, else the bot gate silently
    // disables (fail-open) and the cookie signing key falls back to a
    // hardcoded predictable value -> forgeable cookies. Per 06 section 8:
    // secrets in env, validated at startup. Per 06 section 1: fail closed.
    if (!parsed.data.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
      missing.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    if (!parsed.data.TURNSTILE_SECRET_KEY) missing.push("TURNSTILE_SECRET_KEY");
    if (missing.length > 0) {
      throw new Error(
        `Production requires these env vars:\n` +
          missing.map((m) => `  - ${m}`).join("\n") +
          `\n(Supabase for image storage, Turnstile for bot protection.)`,
      );
    }
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
