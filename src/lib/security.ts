const DANGEROUS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /vbscript:/i,
  /<[^>]*\son\w+\s*=/i,
];

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function validateText(
  value: unknown,
  opts: {
    maxLen?: number;
    minLen?: number;
    required?: boolean;
    rejectCRLF?: boolean;
  } = {},
): ValidationResult {
  const {
    maxLen = 500,
    minLen = 0,
    required = false,
    rejectCRLF = false,
  } = opts;

  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, error: "This field is required." };
    }
    return { valid: true, error: null };
  }
  if (typeof value !== "string") {
    return { valid: false, error: "Invalid type." };
  }

  if (rejectCRLF && /[\r\n]/.test(value)) {
    return {
      valid: false,
      error: "Line breaks are not allowed in this field.",
    };
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
export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface LockoutEntry {
  failures: number;
  lockedUntil: number;
  lastTouched: number;
}
const lockoutStore = new Map<string, LockoutEntry>();
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000;

export function recordLoginFailure(email: string): {
  locked: boolean;
  lockedForMs: number;
} {
  const now = Date.now();
  const key = email.toLowerCase();
  const entry = lockoutStore.get(key) ?? {
    failures: 0,
    lockedUntil: 0,
    lastTouched: now,
  };

  if (entry.lockedUntil && entry.lockedUntil < now) {
    entry.failures = 0;
    entry.lockedUntil = 0;
  }
  entry.failures += 1;
  entry.lastTouched = now;
  if (entry.failures >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    lockoutStore.set(key, entry);
    return { locked: true, lockedForMs: LOCKOUT_DURATION_MS };
  }
  lockoutStore.set(key, entry);
  return { locked: false, lockedForMs: 0 };
}

export function isLoginLocked(email: string): {
  locked: boolean;
  retryAfterMs: number;
} {
  const key = email.toLowerCase();
  const entry = lockoutStore.get(key);
  if (!entry || !entry.lockedUntil) return { locked: false, retryAfterMs: 0 };
  const now = Date.now();
  if (entry.lockedUntil <= now) {
    lockoutStore.delete(key);
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - now };
}

export function clearLoginFailures(email: string): void {
  lockoutStore.delete(email.toLowerCase());
}

export const LOGIN_LOCKOUT_THRESHOLD = LOCKOUT_THRESHOLD;
export const LOGIN_LOCKOUT_DURATION_MS = LOCKOUT_DURATION_MS;

interface RateLimitEntry {
  timestamps: number[];
  lastTouched: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();
const EVICTION_INTERVAL_MS = 5 * 60_000;
const EVICTION_MAX_AGE_MS = 60 * 60_000;
let lastEvictionRun = 0;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

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

export function truncate(str: unknown, maxLen = 100): string {
  if (typeof str !== "string") return "";
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + "…";
}

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

const TRUSTED_PROXY_HOPS = 1;

export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const trustedIndex = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      return parts[trustedIndex] || parts[parts.length - 1];
    }
  }
  return headers.get("x-real-ip") || "unknown";
}
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return email[0] + "***" + email.slice(at);
}

export function sanitizeForHeader(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[\r\n]+/g, " ").trim();
}

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

export function _resetRateLimitForTesting(): void {
  rateLimitStore.clear();
  lockoutStore.clear();
  lastEvictionRun = 0;
}
