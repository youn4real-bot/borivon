import type { Metadata, Viewport } from "next";
import { Lexend, Playfair_Display } from "next/font/google";
import "./globals.css";
import { GlobalChrome } from "@/components/GlobalChrome";
import NextTopLoader from "nextjs-toploader";

// Primary font — Lexend everywhere (UI, body, headings, every surface).
// Mercury-style discipline: one font for the entire system. Lexend has
// peer-reviewed reading-speed gains, especially for non-native readers
// (which matches Borivon's German-learner audience).
//
// Perf: trimmed to 400/500/600/700 (dropped 300 — was unused at scale) and
// preloaded as the LCP-critical font.
const lexend = Lexend({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans-v", // legacy variable name kept; resolves to Lexend
  display: "swap",
  preload: true,
});

// Secondary serif — Playfair Display.
// Used for the "Borivon." brand wordmark (top-left logo) and the large
// decorative background "B." All usages are italic at default weight.
//
// Perf: trimmed to italic-400 only (was 4 weights × 2 styles = 8 files;
// now 1 file). `display: "swap"` + `preload: true` so the wordmark always
// renders in Playfair — brand identity matters more than the few-ms LCP win
// from "optional".
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic"],
  variable: "--font-serif-v",
  display: "swap",
  preload: true,
});


export const metadata: Metadata = {
  metadataBase: new URL("https://borivon.com"),
  title: {
    default: "Borivon — German Language Institute",
    template: "%s | Borivon",
  },
  description:
    "Borivon est une école d'allemand basée à Casablanca offrant des cours A1-B2 en ligne, en présentiel et en entreprise. Formation pour l'Ausbildung, le Studium, l'Arbeit et les organisations.",
  keywords: [
    "cours allemand Casablanca",
    "école allemand Maroc",
    "apprendre allemand",
    "Deutschkurs Marokko",
    "cours allemand entreprise",
    "A1 B2 allemand",
    "Ausbildung allemand",
    "Borivon",
    "formation allemand en ligne",
    "interprétation allemand",
    "traduction allemand",
  ],
  authors: [{ name: "Borivon SARLAU", url: "https://borivon.com" }],
  creator: "Borivon SARLAU",
  publisher: "Borivon SARLAU",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    alternateLocale: ["en_US", "de_DE", "ar_MA"],
    url: "https://borivon.com",
    siteName: "Borivon",
    title: "Borivon — École d'Allemand à Casablanca",
    description:
      "Cours d'allemand A1-B2 pour particuliers et entreprises. En ligne, en présentiel, ou dans vos locaux à Casablanca.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Borivon — École d'Allemand",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Borivon — École d'Allemand à Casablanca",
    description: "Cours d'allemand A1-B2 pour particuliers et entreprises.",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "https://borivon.com",
    languages: {
      "fr-MA": "https://borivon.com",
      "en-MA": "https://borivon.com?lang=en",
      "de-MA": "https://borivon.com?lang=de",
    },
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  verification: {
    google: "your-google-site-verification-token",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" dir="ltr" className={`${lexend.variable} ${playfair.variable}`}>
      <head>
        {/* Resource hints — let the browser open TCP+TLS to our hot origins
            during HTML parse, before any subresource is actually requested.
            Saves ~100-300ms on the first Supabase / Drive proxy call. */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://supabase.co"} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://supabase.co"} />
        <link rel="preconnect" href="https://lh3.googleusercontent.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://lh3.googleusercontent.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "LanguageSchool",
              name: "Borivon",
              legalName: "Borivon SARLAU",
              url: "https://borivon.com",
              logo: "https://borivon.com/logo.png",
              description:
                "École d'allemand à Casablanca. Cours A1-B2 en ligne et sur site pour particuliers et entreprises.",
              address: {
                "@type": "PostalAddress",
                streetAddress: "77 Boulevard Mohamed Smiha",
                postalCode: "20080",
                addressLocality: "Casablanca",
                addressCountry: "MA",
              },
              contactPoint: [
                {
                  "@type": "ContactPoint",
                  telephone: "+212700300174",
                  contactType: "customer service",
                  availableLanguage: ["French", "Arabic", "German", "English"],
                },
                {
                  "@type": "ContactPoint",
                  telephone: "+4915731504759",
                  contactType: "customer service",
                  availableLanguage: ["German", "French", "English"],
                },
              ],
              email: "contact@borivon.com",
              sameAs: [],
              areaServed: ["MA", "DE"],
              availableLanguage: ["French", "Arabic", "German", "English"],
              priceRange: "$$",
              courseMode: ["online", "onsite", "blended"],
            }),
          }}
        />
      </head>
      <body>
        {/* Top progress bar on every Next-link navigation. Gives instant
            click feedback — bar starts immediately, page hydrates in
            parallel. Same idiom Linear / Vercel use. */}
        <NextTopLoader
          color="var(--gold)"
          height={2.5}
          showSpinner={false}
          shadow="0 0 8px var(--border-gold)"
          easing="ease"
          speed={250}
        />
        <GlobalChrome>{children}</GlobalChrome>
      </body>
    </html>
  );
}
