import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

const siteUrl = siteConfig.url;

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

  // FAQ is a content section, not a policy, but still worth indexing.
  const contentRoutes = ["faq"];

  const routes = [
    "/",
    ...policyRoutes.map((p) => `/?section=${p}`),
    ...contentRoutes.map((c) => `/?section=${c}`),
  ];

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: route === "/" ? 1 : 0.6,
  }));
}
