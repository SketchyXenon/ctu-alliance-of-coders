// Helpers for the Announcement links field.
// Links are stored as a JSON-encoded array of {url, label} in the DB (a single
// String column). This module handles serialization, parsing, and validation.
// Per 06-security-architecture.md section 5: validate all external input.
// Per 03 section 6: fail fast with clear messages.

import type { AnnouncementLink } from "./types";

const MAX_LINKS = 10;
const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 120;

/** Today's date as a local YYYY-MM-DD string (not UTC) so announcements
 *  created before 08:00 UTC+8 are not labeled with the previous day. */
export function localDateISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when `s` matches YYYY-MM-DD AND is a real calendar date.
 *  The regex alone accepts "2024-02-31" / "9999-99-99"; the round-trip
 *  through Date rejects impossible dates so stored rows always sort and
 *  render correctly. */
export function isValidDateISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

/** Serialize an array of AnnouncementLink to the DB string format. */
export function serializeLinks(links: AnnouncementLink[]): string {
  return JSON.stringify(links);
}

/**
 * Parse the DB string back into an array of AnnouncementLink.
 * Defensive: handles null, empty string, and malformed JSON (returns []).
 * Per 06 section 1: fail safe — a corrupt links field should not crash the
 * page render.
 */
export function parseLinks(raw: string | null | undefined): AnnouncementLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AnnouncementLink =>
          typeof item === "object" &&
          item !== null &&
          typeof item.url === "string" &&
          typeof item.label === "string",
      )
      .slice(0, MAX_LINKS);
  } catch {
    return [];
  }
}

export interface LinkValidationResult {
  valid: boolean;
  error: string | null;
  normalized: AnnouncementLink | null;
}

/**
 * Validate a single announcement link.
 * Accepts http/https URLs only (rejects javascript:, data:, file:, etc.).
 * Per 06 section 5: never trust external input. Per 06 section 8: reject
 * non-https schemes that could be used for XSS or SSRF.
 */
export function validateAnnouncementLink(
  url: unknown,
  label: unknown,
): LinkValidationResult {
  if (typeof url !== "string" || typeof label !== "string") {
    return {
      valid: false,
      error: "Link URL and label are required.",
      normalized: null,
    };
  }

  const trimmedUrl = url.trim();
  const trimmedLabel = label.trim();

  if (!trimmedUrl) {
    return { valid: false, error: "Link URL is required.", normalized: null };
  }
  if (trimmedUrl.length > MAX_URL_LENGTH) {
    return { valid: false, error: "Link URL is too long.", normalized: null };
  }

  // Parse the URL to check the scheme. Only http and https are allowed.
  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return { valid: false, error: "Invalid link URL.", normalized: null };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return {
      valid: false,
      error: `Link URLs must use http or https (got ${scheme.replace(":", "")}).`,
      normalized: null,
    };
  }

  // Label is optional — default to the URL hostname.
  const finalLabel = trimmedLabel || parsed.hostname;

  if (finalLabel.length > MAX_LABEL_LENGTH) {
    return {
      valid: false,
      error: "Link label is too long (max 120 chars).",
      normalized: null,
    };
  }

  return {
    valid: true,
    error: null,
    normalized: { url: trimmedUrl, label: finalLabel },
  };
}

/**
 * Validate an array of links (from the API request body).
 * Returns { valid, error, normalized } where normalized is the clean array.
 */
export function validateAnnouncementLinks(input: unknown): {
  valid: boolean;
  error: string | null;
  normalized: AnnouncementLink[];
} {
  if (input === undefined || input === null) {
    return { valid: true, error: null, normalized: [] };
  }
  if (!Array.isArray(input)) {
    return { valid: false, error: "Links must be an array.", normalized: [] };
  }
  if (input.length > MAX_LINKS) {
    return {
      valid: false,
      error: `Maximum ${MAX_LINKS} links per announcement.`,
      normalized: [],
    };
  }

  const normalized: AnnouncementLink[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    const url = (item as Record<string, unknown>)?.url;
    const label = (item as Record<string, unknown>)?.label;
    const result = validateAnnouncementLink(url, label);
    if (!result.valid) {
      return {
        valid: false,
        error: `Link ${i + 1}: ${result.error}`,
        normalized: [],
      };
    }
    normalized.push(result.normalized!);
  }

  return { valid: true, error: null, normalized };
}

export const LINKS_MAX = MAX_LINKS;
export const LINK_LABEL_MAX = MAX_LABEL_LENGTH;
export const LINK_URL_MAX = MAX_URL_LENGTH;
