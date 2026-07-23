import type { MetadataRoute } from "next";

const siteUrl = "https://allianceofcoders.ph";

/**
 * robots.txt - generated dynamically at /robots.xml.
 * Allows all crawlers, points to the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
