import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
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
    sitemap: "https://borivon.com/sitemap.xml",
  };
}
