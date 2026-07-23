import type { MetadataRoute } from "next";

const siteUrl = "https://allianceofcoders.ph";

/**
 * sitemap.xml - generated dynamically at /sitemap.xml.
 * Lists the single user-facing route plus all policy pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const policyRoutes = [
    "Privacy Policy",
    "Data Protection",
    "Terms of Use",
    "Cookie Policy",
  ].map((p) => p.toLowerCase().replace(/\s+/g, "-"));

  const routes = ["/", ...policyRoutes.map((p) => `/?section=${p}`)];

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: route === "/" ? 1 : 0.6,
  }));
}
