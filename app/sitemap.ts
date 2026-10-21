import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://borivon.com";
  const now = new Date();
  // Borivon is nurses only (2026-10-20): home is the nurse-placement page.
  return [
    { url: base, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/fahrplan`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/plattform`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/book/clinic`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/book/nurse`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/impressum`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
