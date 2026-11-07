import type { Metadata } from "next";
import { PrivacyView } from "@/components/PrivacyView";

/**
 * Datenschutzerklärung — the German privacy policy (founder, 2026-11-07).
 * Always German: German visitors and every link from /fahrplan land here.
 * Same text source as /privacy-policy (lib/privacyContent.ts).
 */
export const metadata: Metadata = {
  title: "Datenschutzerklärung",
  description: "Datenschutzerklärung der Borivon LLC: welche Daten wir verarbeiten, warum, wie lange, und Ihre Rechte.",
  alternates: { canonical: "https://borivon.com/datenschutz" },
};

export default function DatenschutzPage() {
  return <PrivacyView lang="de" />;
}
