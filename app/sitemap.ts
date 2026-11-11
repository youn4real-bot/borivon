import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://borivon.com";
  const now = new Date();
  // Since 2026-11-09 the site = free value (Fahrplan + free tools) and the paid workshop.
  // No call bookings here: the only call is the workshop seat check, reached from /workshop.
  return [
    { url: base, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/fahrplan`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/workshop`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/fahrplan/rechner`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/fahrplan/kosten`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/fahrplan/warten`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/fahrplan/bleibe-check`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/impressum`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/datenschutz`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
