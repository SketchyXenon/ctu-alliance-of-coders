// Centralized site configuration - single source of truth for all site-wide
// URLs, social links, and contact info. Reads from NEXT_PUBLIC_ env vars so
// the same values are available on both server and client.
// Per Z.md (single source of truth) and 03-software-engineering.md (DRY).
//
// IMPORTANT: Next.js inlines NEXT_PUBLIC_ vars at build time by replacing
// DIRECT references (process.env.NEXT_PUBLIC_X). Dynamic lookups like
// process.env[key] are NOT inlined and return undefined on the client. So we
// must reference each var directly here, not via a helper function.

// Direct references so Next.js inlines these into the client bundle.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";
const FACEBOOK_URL = process.env.NEXT_PUBLIC_FACEBOOK_URL || "";
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "";
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";

export const siteConfig = {
  /** Canonical site URL (no trailing slash). Falls back to localhost in dev. */
  get url(): string {
    return SITE_URL || "http://localhost:3000";
  },

  /** Organization name (hardcoded brand, not env-configurable). */
  name: "Alliance of Coders",
  shortName: "AoC",
  campus: "CTU Danao Campus",

  /** Contact email from env. null if not set. */
  get contactEmail(): string | null {
    return CONTACT_EMAIL || null;
  },
} as const;

export interface SocialLink {
  key: string;
  label: string;
  /** Lucide icon name (resolved by the consumer). */
  icon: "Facebook" | "Github" | "Mail";
  /** URL from env. null if the env var is not set (link is not rendered). */
  href: string | null;
}

/**
 * Social links from env vars. Links with no env value are excluded (null href).
 * This is the single source of truth - no hardcoded fallback URLs anywhere.
 * Per 06-security-architecture.md: don't ship default URLs that might point
 * to accounts the org doesn't control.
 */
export function getSocialLinks(): SocialLink[] {
  const links: SocialLink[] = [
    {
      key: "facebook",
      label: "Facebook",
      icon: "Facebook",
      href: FACEBOOK_URL || null,
    },
    {
      key: "github",
      label: "GitHub",
      icon: "Github",
      href: GITHUB_URL || null,
    },
  ];

  // Email is a mailto: link, only if the env var is set.
  if (CONTACT_EMAIL) {
    links.push({
      key: "email",
      label: "Email",
      icon: "Mail",
      href: `mailto:${CONTACT_EMAIL}`,
    });
  }

  return links;
}

/**
 * sameAs array for JSON-LD Organization schema. Only includes URLs that are
 * actually set in env. Per 05-ui-ux-design.md section 8 (structured data).
 */
export function getSameAsUrls(): string[] {
  const urls: string[] = [];
  if (FACEBOOK_URL) urls.push(FACEBOOK_URL);
  if (GITHUB_URL) urls.push(GITHUB_URL);
  return urls;
}
