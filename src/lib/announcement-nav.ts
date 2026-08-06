// Pure helpers for the announcement dedicated-view URL hash.

export const ANNOUNCEMENT_HASH_PREFIX = "announcement=";

/**
 * Parse a URL hash string and return the announcement id it references, or
 * null if the hash is absent / malformed. Tolerant of leading '#', '#/', and
 * surrounding whitespace so deep links from emails / social share work.
 *
 * @example
 *   parseAnnouncementHash("#announcement=abc-123")  -> "abc-123"
 *   parseAnnouncementHash("#/announcement=abc-123") -> "abc-123"
 *   parseAnnouncementHash("announcement=abc-123")   -> "abc-123"
 *   parseAnnouncementHash("#faq")                   -> null
 *   parseAnnouncementHash("")                       -> null
 */
export function parseAnnouncementHash(hash: string): string | null {
  if (!hash) return null;

  const stripped = hash.replace(/^\s*#\/?/, "").trim();
  if (!stripped.startsWith(ANNOUNCEMENT_HASH_PREFIX)) return null;
  const raw = stripped.slice(ANNOUNCEMENT_HASH_PREFIX.length).trim();
  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function buildAnnouncementHash(id: string): string {
  return `#${ANNOUNCEMENT_HASH_PREFIX}${encodeURIComponent(id)}`;
}
