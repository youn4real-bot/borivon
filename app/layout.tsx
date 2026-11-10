import type { Metadata, Viewport } from "next";
import { EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GlobalChrome } from "@/components/GlobalChrome";
import NextTopLoader from "nextjs-toploader";
import { SITE_ZONE_BOOT } from "@/lib/siteZone";

// Fonts = borivon.com since 2026-11-09 (founder: "this design and font is really good, apply it to
// all the website", the portal included): Inter for every text, EB Garamond for the wordmark and
// headlines. next/font self-hosts them (no request to Google from the visitor's browser).
// The CSS variable names are the old ones on purpose: every page and the portal switch with them.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans-v", // legacy variable name kept; resolves to Inter
  display: "swap",
  preload: true,
});

// The "Borivon." wordmark and the large decorative "B.": EB Garamond italic.
const garamond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["italic"],
  variable: "--font-serif-v",
  display: "swap",
  preload: true,
});

// Headlines: EB Garamond upright (globals.css "RENOVATION 2026-10": h1, h2). Not preloaded.
const garamondUpright = EB_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
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
    default: "Borivon · Pflegekräfte gewinnen und halten",
    template: "%s | Borivon",
  },
  // the motto, word for word (founder: Borivon helps facilities, it never "brings nurses")
  description:
    "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
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
    title: "Borivon · Pflegekräfte gewinnen und halten",
    description: "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
    images: [{ url: "/pflege/assets/og-fahrplan.png", width: 1200, height: 630, alt: "Borivon · Der kostenlose Pflege-Fahrplan" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Borivon · Pflegekräfte gewinnen und halten",
    description: "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
    images: ["/pflege/assets/og-fahrplan.png"],
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
    <html lang="de" dir="ltr" className={`${inter.variable} ${garamond.variable} ${garamondUpright.variable} ${mono.variable}`}>
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
        {/* Typography zone before first paint: public pages get the borivon.com headline
            type (EB Garamond); the portal keeps one text font, Inter (lib/siteZone.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SITE_ZONE_BOOT }} />
        {/* No preconnects to other companies here: a preconnect alone hands the visitor's IP to
            that server (the German "Google Fonts" rulings), and these pages are public, e.g. the
            /workshop calendar. Fonts are bundled by next/font. The portal adds its own hints
            (app/portal/layout.tsx) for logged-in users. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              // Since 2026-11-09 the site gives free value + one paid workshop; no placement sales.
              "@type": "Organization",
              name: "Borivon",
              legalName: "Borivon LLC",
              url: "https://borivon.com",
              logo: "https://borivon.com/logo.png",
              description:
                "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
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
