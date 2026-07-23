import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

const siteUrl = siteConfig.url;

/**
 * robots.txt - generated dynamically. Allows the public HTML route but blocks
 * /api/ to prevent endpoint enumeration and indexing of auth/admin surfaces
 * (06 section 5: reduce attack surface). Points to the sitemap (05 section 8).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
