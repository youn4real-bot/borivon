import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://borivon.com";
  const now = new Date();
  const langs = {
    fr: base,
    en: `${base}?lang=en`,
    de: `${base}?lang=de`,
    ar: `${base}?lang=ar`,
  };

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: langs },
    },
    // Static marketing / legal pages — all crawlable, low change frequency.
    // These were missing from the sitemap → Google never linked them as
    // sibling pages of the home, even though they exist and are stable.
    {
      url: `${base}/privacy-policy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${base}/refund-policy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
