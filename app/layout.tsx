import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Lexend, Playfair_Display } from "next/font/google";
import "./globals.css";
import { GlobalChrome } from "@/components/GlobalChrome";
import NextTopLoader from "nextjs-toploader";
import { SITE_ZONE_BOOT } from "@/lib/siteZone";

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

// Headline serif — Playfair Display upright (500–700), the /pflege look carried
// into the portal (see "RENOVATION 2026-10" in globals.css: h1, h2). Not
// preloaded: headlines swap in, the wordmark above stays the LCP-critical file.
const playfairUpright = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal"],
  variable: "--font-serif-upright-v",
  display: "swap",
  preload: false,
});

// Label mono — JetBrains Mono for eyebrows, uppercase field labels and small
// meta, exactly like /pflege. Not preloaded: labels swap in after the text.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-v",
  display: "swap",
  preload: false,
});


export const metadata: Metadata = {
  metadataBase: new URL("https://borivon.com"),
  title: {
    default: "Borivon — Pflegefachkräfte, die bleiben",
    template: "%s | Borivon",
  },
  description:
    "Borivon bringt geprüfte Pflegefachkräfte nach Deutschland. Sie führen ein Interview, wir machen den Rest: Deutsch, Anerkennung, Visum, Ankommen. Und sie bleibt.",
  keywords: [
    "Pflegefachkräfte",
    "Pflegekräfte aus dem Ausland",
    "Pflegekräfte Marokko",
    "Anerkennung Pflege",
    "Fachkräfteeinwanderung Pflege",
    "Borivon",
  ],
  authors: [{ name: "Borivon LLC", url: "https://borivon.com" }],
  creator: "Borivon LLC",
  publisher: "Borivon LLC",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    type: "website",
    locale: "de_DE",
    alternateLocale: ["en_US", "fr_FR"],
    url: "https://borivon.com",
    siteName: "Borivon",
    title: "Borivon — Pflegefachkräfte, die bleiben",
    description: "Ein Interview. Wir machen den Rest. Und sie bleibt.",
    images: [{ url: "/pflege/assets/nurse.jpg", alt: "Borivon — Pflegefachkräfte, die bleiben" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Borivon — Pflegefachkräfte, die bleiben",
    description: "Ein Interview. Wir machen den Rest. Und sie bleibt.",
    images: ["/pflege/assets/nurse.jpg"],
  },
  // NOTE: no `alternates.canonical` here on purpose.
  //
  // Next merges the ROOT layout's metadata into every page, so a canonical set
  // at this level is emitted verbatim on every URL of the site. It was
  // "https://borivon.com", which told Google that /v2, the join page, every
  // public candidate page and even /portal are all duplicates of the homepage —
  // i.e. index none of them, show the homepage instead. That is the whole
  // public site asking not to be found, and it silently undid every SEO change
  // made above it.
  //
  // A canonical is only correct when it is per-page, so each page that wants
  // one now declares it in its own `metadata` (see app/page.tsx). The hreflang
  // set moved with it — it described the homepage's language variants, not
  // every page's. `metadataBase` at the top of this object is what lets a page
  // declare a relative canonical and have it resolve to the right absolute URL.
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  // verification: { google: "..." } removed — the default placeholder string
  // was being rendered as a real <meta name="google-site-verification"> on
  // every page, which Google Search Console would reject as invalid. Re-add
  // this block (with a real token) only after claiming the property in GSC.
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
    <html lang="fr" dir="ltr" className={`${lexend.variable} ${playfair.variable} ${playfairUpright.variable} ${mono.variable}`}>
      <head>
        {/* Affiliate subdomain marker — runs synchronously before first paint so
            the global chrome (navbar/flag-strip/actions) is CSS-hidden on
            affiliates.borivon.com with NO flash. The middleware rewrites the
            subdomain to /affiliate/*, which makes usePathname() report "/", so a
            pathname check can't detect it — the host is the only reliable signal,
            and doing it here avoids making the whole app dynamic via headers(). */}
        <script
          dangerouslySetInnerHTML={{
            // Inject a <style> node (React reconciles <html>'s class AND its
            // attributes during hydration, so a class/attr set here gets wiped —
            // verified. A script-appended <head> style is NOT in React's tree, so
            // it survives and hides the global chrome before first paint, no flash).
            __html: "try{if((location.hostname||'').split('.')[0]==='affiliates'){var s=document.createElement('style');s.textContent='.bv-chrome{display:none!important}';(document.head||document.documentElement).appendChild(s);}}catch(e){}",
          }}
        />
        {/* Typography zone before first paint: public pages get the /pflege headline
            type, /portal stays Lexend (lib/siteZone.ts; GlobalChrome keeps it in sync). */}
        <script dangerouslySetInnerHTML={{ __html: SITE_ZONE_BOOT }} />
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
              // Borivon is nurse placement only since 2026-10-20 (no language school).
              "@type": "EmploymentAgency",
              name: "Borivon",
              legalName: "Borivon LLC",
              url: "https://borivon.com",
              logo: "https://borivon.com/logo.png",
              description:
                "Borivon bringt geprüfte Pflegefachkräfte nach Deutschland: Deutsch, Anerkennung, Visum und Ankommen aus einer Hand. Mit Bleibegarantie.",
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
