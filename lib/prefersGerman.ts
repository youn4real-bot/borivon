/** First Accept-Language tag is German: "de-DE,de;q=0.9,en;q=0.8" → true. Edge-safe. */
export function prefersGerman(acceptLanguage: string | null): boolean {
  const first = (acceptLanguage || "").split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  return first === "de" || first.startsWith("de-");
}
