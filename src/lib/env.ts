// Centralized environment variable validation.
// Per 06-security-architecture.md: secrets in env, validated at startup.
// Per 03-software-engineering.md: fail fast and loud on misconfiguration.

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_FACEBOOK_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_GITHUB_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_CONTACT_EMAIL: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
      `Environment validation failed:\n${issues}\n\nCheck .env or Vercel settings.`
    );
  }

  // Production requires Supabase for image storage.
  if (parsed.data.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!parsed.data.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!parsed.data.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length > 0) {
      throw new Error(
        `Production requires Supabase env vars:\n` +
          missing.map((m) => `  - ${m}`).join("\n")
      );
    }
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
