import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://borivon.com";
  const now = new Date();

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1,
      alternates: {
        languages: {
          fr: `${base}`,
          en: `${base}?lang=en`,
          de: `${base}?lang=de`,
          ar: `${base}?lang=ar`,
        },
      },
    },
  ];
}
