// Server-side security utilities.
// OWASP-aligned: input validation, rate limiting, CSRF helpers.
// Per 06-security-architecture.md: never trust the client, validate all input,
// fail closed, defense in depth.

// Patterns that indicate possible script injection in display fields.
// NOTE: defense-in-depth blocklist for DISPLAY text only. React escapes at
// render time; this catches input that would be dangerous if ever rendered
// raw. MUST NOT be applied to password fields; use validatePassword from
// lib/validation.ts for those (strong passwords may legitimately contain
// these substrings). See 06-security-architecture.md S2.
const DANGEROUS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /vbscript:/i,
  /on\w+\s*=/i,
];

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/** Validate a plain-text display field with length and dangerous-pattern checks. */
export function validateText(
  value: unknown,
  opts: { maxLen?: number; minLen?: number; required?: boolean } = {}
): ValidationResult {
  const { maxLen = 500, minLen = 0, required = false } = opts;
  if (typeof value !== "string") {
    return { valid: false, error: "Invalid type." };
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    return { valid: false, error: "This field is required." };
  }
  if (trimmed.length < minLen) {
    return { valid: false, error: `Minimum ${minLen} characters required.` };
  }
  if (trimmed.length > maxLen) {
    return { valid: false, error: `Maximum ${maxLen} characters allowed.` };
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      return { valid: false, error: "Input contains disallowed content." };
    }
  }
  return { valid: true, error: null };
}

/** Validate an email format (RFC-ish, conservative). */
export function validateEmail(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: "Invalid email." };
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 254) {
    return { valid: false, error: "Email must be 5-254 characters." };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: "Please enter a valid email address." };
  }
  return { valid: true, error: null };
}

/** Generate a cryptographically random token (CSRF or session). */
export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * In-memory sliding-window rate limiter.
 * Per 06-security-architecture.md section 7: rate limit auth and expensive
 * endpoints, return 429 with Retry-After. Singleton for app-wide use.
 *
 * Trade-off: in-memory => single-instance only. For multi-instance production,
 * back this with Redis/Upstash. Empty entries are swept periodically to avoid
 * unbounded memory growth (S3).
 */
interface RateLimitEntry {
  timestamps: number[];
  lastTouched: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();
const EVICTION_INTERVAL_MS = 5 * 60_000; // sweep every 5 minutes
const EVICTION_MAX_AGE_MS = 60 * 60_000; // drop entries untouched for 1 hour
let lastEvictionRun = 0;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Periodic sweep of stale entries to bound memory (S3).
  if (now - lastEvictionRun > EVICTION_INTERVAL_MS) {
    lastEvictionRun = now;
    for (const [k, v] of rateLimitStore) {
      if (now - v.lastTouched > EVICTION_MAX_AGE_MS) {
        rateLimitStore.delete(k);
      }
    }
  }

  const entry = rateLimitStore.get(key) ?? { timestamps: [], lastTouched: now };
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  entry.lastTouched = now;
  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
    return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
  }
  entry.timestamps.push(now);
  rateLimitStore.set(key, entry);
  return { allowed: true, retryAfterMs: 0 };
}

/** Truncate a string safely for display. */
export function truncate(str: unknown, maxLen = 100): string {
  if (typeof str !== "string") return "";
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + "…";
}

/** Format an ISO timestamp into a relative + absolute form. */
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// Trusted proxy hop count. The sandbox gateway (Caddy) is 1 hop in front of
// this app, so the rightmost X-Forwarded-For entry is the gateway's view of
// the real client. Anything to the left of that is client-supplied and
// spoofable. Per 06-security-architecture.md section 7: do not trust
// client-controlled headers for rate-limit keying (M4 fix).
const TRUSTED_PROXY_HOPS = 1;

/** Extract the real client IP, trusting only the rightmost TRUSTED_PROXY_HOPS
 *  entries of X-Forwarded-For. Shared by proxy.ts and API routes so the
 *  rate-limit key is consistent and not spoofable. */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const trustedIndex = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      return parts[trustedIndex] || parts[parts.length - 1];
    }
  }
  return headers.get("x-real-ip") || "unknown";
}

/** Mask an email for logs: a***@example.com. Per 06-security-architecture.md
 *  section 11: never log full PII in warn/info logs; keep the full value only
 *  in the access-controlled audit trail (M5 fix). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return email[0] + "***" + email.slice(at);
}

/** Format an ISO timestamp into a relative + absolute form. */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
