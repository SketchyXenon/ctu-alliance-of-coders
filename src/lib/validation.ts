// Shared validation helpers for API route handlers.
// Per 03-software-engineering.md: DRY, separation of concerns.
// Per 06-security-architecture.md: validate all external input, fail closed.
//
// IMPORTANT: this module is imported by both client and server code (e.g.
// login-form.tsx imports validatePassword). Do NOT add top-level imports of
// server-only modules (logger uses async_hooks, prisma-error uses @prisma/client).
// Server-only helpers below use dynamic imports to stay client-safe.

import { validateText, validateEmail } from "./security";

const MAX_IMAGE_URL_LEN = 2048;
// Allow only relative ("/uploads/..."), data: URIs we reject, and https URLs.
// Reject javascript:, vbscript:, file:, etc. outright.
const URL_PROTOCOL_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Validate an image URL stored against an Announcement or Officer.
 * Accepts:
 *   - relative paths starting with "/" (server-generated uploads)
 *   - absolute https URLs (for prod Supabase Storage)
 * Rejects: javascript:, vbscript:, data:, file:, and anything that fails URL parsing.
 * Per 06-security-architecture.md S1: image fields were stored verbatim; now validated.
 */
export function validateImageUrl(value: unknown): {
  valid: boolean;
  error: string | null;
  normalized: string | null;
} {
  if (value === null || value === undefined || value === "") {
    return { valid: true, error: null, normalized: null };
  }
  if (typeof value !== "string") {
    return { valid: false, error: "Image must be a string.", normalized: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: true, error: null, normalized: null };
  }
  if (trimmed.length > MAX_IMAGE_URL_LEN) {
    return { valid: false, error: "Image URL is too long.", normalized: null };
  }
  // Relative path: allow "/uploads/..." and "/<something>".
  if (trimmed.startsWith("/")) {
    // Guard against path traversal in stored URLs.
    if (trimmed.includes("..")) {
      return { valid: false, error: "Invalid image path.", normalized: null };
    }
    return { valid: true, error: null, normalized: trimmed };
  }
  const protoMatch = URL_PROTOCOL_RE.exec(trimmed);
  if (!protoMatch) {
    return { valid: false, error: "Invalid image URL.", normalized: null };
  }
  const proto = protoMatch[1].toLowerCase();
  if (proto !== "https") {
    return {
      valid: false,
      error: "Image URL must use https.",
      normalized: null,
    };
  }
  try {
    new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid image URL.", normalized: null };
  }
  return { valid: true, error: null, normalized: trimmed };
}

/** Validate a password without applying display-field XSS blocklists. */
export function validatePassword(
  value: unknown,
  opts: { minLen?: number; maxLen?: number } = {},
): { valid: boolean; error: string | null; value: string | null } {
  const { minLen = 8, maxLen = 128 } = opts;
  if (typeof value !== "string") {
    return { valid: false, error: "Password must be a string.", value: null };
  }
  if (value.length === 0) {
    return { valid: false, error: "Password is required.", value: null };
  }
  if (value.length < minLen) {
    return {
      valid: false,
      error: `Password must be at least ${minLen} characters.`,
      value: null,
    };
  }
  if (value.length > maxLen) {
    return {
      valid: false,
      error: `Password must be under ${maxLen} characters.`,
      value: null,
    };
  }
  // NOTE: deliberately do NOT apply DANGEROUS_PATTERNS here.
  // Strong passwords may legitimately contain "<script", "onerror=", etc.
  return { valid: true, error: null, value };
}

// NOTE: withPrismaError lives in src/lib/route-helpers.ts (server-only) to keep
// this module safe for client-component imports.

// Re-export common validators for convenience at route call sites.
export { validateText, validateEmail };
