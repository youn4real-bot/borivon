import type { Metadata } from "next";
import { ClientPage } from "@/components/ClientPage";

export const metadata: Metadata = {
  title: "Borivon — German Language Institute",
  description:
    "Apprenez l'allemand avec Borivon — cours en ligne et sur site pour particuliers (Ausbildung, Studium, Arbeit) et entreprises à Casablanca. A1 à B2, instructeurs qualifiés.",
  openGraph: {
    title: "Borivon — École d'Allemand à Casablanca",
    description:
      "Cours d'allemand A1-B2 pour particuliers et entreprises. En ligne, en présentiel, ou dans vos locaux.",
  },
  // The canonical + hreflang set used to live in the ROOT layout, where Next
  // merged it onto every URL of the site — so every page claimed to be a
  // duplicate of this one. It belongs here, on the page it actually describes.
  alternates: {
    canonical: "/",
    languages: {
      "fr-MA": "https://borivon.com",
      "en-MA": "https://borivon.com?lang=en",
      "de-MA": "https://borivon.com?lang=de",
    },
  },
};

export default function Home() {
  return <ClientPage />;
}
