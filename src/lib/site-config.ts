const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";
const FACEBOOK_URL = process.env.NEXT_PUBLIC_FACEBOOK_URL || "";
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "";
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";

export const siteConfig = {
  get url(): string {
    return SITE_URL || "http://localhost:3000";
  },

  name: "Alliance of Coders",
  shortName: "AoC",
  campus: "CTU Danao Campus",

  get contactEmail(): string | null {
    return CONTACT_EMAIL || null;
  },
} as const;

export interface SocialLink {
  key: string;
  label: string;

  icon: "Facebook" | "Github" | "Mail";

  href: string | null;
}

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

export function getSameAsUrls(): string[] {
  const urls: string[] = [];
  if (FACEBOOK_URL) urls.push(FACEBOOK_URL);
  if (GITHUB_URL) urls.push(GITHUB_URL);
  return urls;
}
