import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

const siteUrl = siteConfig.url;

/**
 * robots.txt - generated dynamically. Per 05-ui-ux-design.md section 8 (SEO)
 * and 06-security-architecture.md section 5 (reduce attack surface).
 *
 * - Allows legitimate search engines (Google, Bing, etc.) on the public route.
 * - Disallows /api/ for all bots (prevents endpoint enumeration).
 * - Blocks known aggressive AI scrapers that don't respect llms.txt / ai.txt.
 *   Legitimate AI crawlers (GPTBot, ClaudeBot, PerplexityBot) are allowed on
 *   public content; they respect robots.txt and provide value via search.
 *   Aggressive scrapers (Bytespider, CCBot used for training without
 *   attribution) are blocked.
 * - Points to the sitemap (05 section 8) and llms.txt (LLM crawler guide).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Legitimate AI crawlers — allowed on public content, blocked from API.
      {
        userAgent: ["GPTBot", "ClaudeBot", "Claude-Web", "PerplexityBot", "Google-Extended"],
        allow: "/",
        disallow: ["/api/"],
      },
      // Aggressive AI scrapers — blocked entirely (don't respect llms.txt / ai.txt).
      {
        userAgent: ["Bytespider", "CCBot", "Amazonbot", "DotBot", "PetalBot"],
        disallow: "/",
      },
      // All other bots — allow public content, block API.
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
