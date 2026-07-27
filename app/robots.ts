import type { MetadataRoute } from "next";

/**
 * AI TRAINING + SCRAPING CRAWLERS ARE BLOCKED (founder's decision, 2026-07-27).
 *
 * Two different jobs, and they must never be confused:
 *   • SEARCH crawlers (Googlebot, Bingbot, …) send us customers → ALLOWED.
 *   • AI TRAINING / SCRAPER bots take the content and give nothing back →
 *     BLOCKED. Borivon's method, course descriptions and pricing are the
 *     product; there is no upside to them becoming training data.
 *
 * Google specifically: `Google-Extended` controls Gemini training and is a
 * SEPARATE token from `Googlebot` — blocking it costs nothing in search
 * ranking. Same for `Applebot-Extended` vs `Applebot`. Never add plain
 * `Googlebot`, `Bingbot` or `Applebot` to the list below: that would delist
 * the site.
 *
 * robots.txt is a REQUEST, not a wall — a well-behaved crawler honours it, a
 * malicious scraper ignores it. Cloudflare's own bot controls (dashboard →
 * Security → Bots → "Block AI Scrapers and Crawlers") are the enforcement
 * layer if that ever becomes necessary.
 */

/** Bots whose purpose is harvesting content for model training or AI answers. */
const AI_CRAWLERS = [
  // OpenAI — training, live browsing, and their search index.
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  // Anthropic
  "ClaudeBot",
  "Claude-Web",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  // Google Gemini training — does NOT affect Googlebot / search ranking.
  "Google-Extended",
  // Apple Intelligence training — does NOT affect Applebot / Siri search.
  "Applebot-Extended",
  // Meta / Llama
  "meta-externalagent",
  "Meta-ExternalAgent",
  "FacebookBot",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Amazon
  "Amazonbot",
  // ByteDance / TikTok
  "Bytespider",
  // Common Crawl — the dataset most open models are trained on.
  "CCBot",
  // Others that scrape at scale for AI products or data resale.
  "Diffbot",
  "omgili",
  "omgilibot",
  "ImagesiftBot",
  "Timpibot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "YouBot",
  "AI2Bot",
  "PanguBot",
  "Webzio-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /api/* are server-only JSON endpoints — no SEO value, and an
        // accidental crawler that hits an authenticated path just gets 401.
        // Saves crawl budget for pages that actually matter.
        // /portal is the candidate-only app shell behind auth; nothing
        // beneath it should ever be indexed (PII risk and the page is
        // useless without a session).
        disallow: ["/api/", "/portal", "/portal/"],
      },
      // One block per bot. `Disallow: /` is the whole site, /book included.
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    sitemap: "https://borivon.com/sitemap.xml",
  };
}
