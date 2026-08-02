import type { NextConfig } from "next";

// ─── Security headers (OWASP secure-headers recommendation) ──────────────────
// Sent on every response. Defense-in-depth against XSS, clickjacking, MIME-
// sniffing, mixed-content downgrade, and referrer-leak attacks.
//
// CSP notes:
//   - 'unsafe-inline' on script-src is required because Next.js injects an
//     inline bootstrap script. The proper long-term fix is per-request nonces,
//     but that's a much larger refactor. The policy still blocks every
//     EXTERNAL script source except the trusted CDNs explicitly listed.
//   - frame-src locks third-party embeds to YouTube + Loom + Turnstile +
//     Stripe only. Anything else attempting to iframe in is blocked.
//   - frame-ancestors 'self' is the modern replacement for X-Frame-Options
//     (we still send X-Frame-Options for older browsers).
//   - connect-src includes wss: for Supabase realtime + https: for Drive
//     proxy / Supabase / external icons.
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the CSP. The EXACT SAME string is mirrored in
// vercel.json — keep them byte-identical. (Both files emit a CSP header on
// Vercel; if they differ the browser enforces the intersection, which silently
// broke embeds. Identical strings = predictable, tight policy.)
//   - connect-src is pinned to Supabase (REST + realtime wss), Cloudflare
//     Turnstile, and Stripe — NOT a blanket `https:` (which let injected JS
//     exfiltrate anywhere). All other external calls (Vision, Turnstile verify)
//     are server-side and not subject to browser connect-src.
//   - frame-src is the UNION of every embed actually used: Drive (iOS PDF),
//     YouTube + Loom (feed videos), Cloudflare, Stripe.
//   - img-src drops `http:` (no mixed content).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // wss/https *.borivon.com → the self-hosted LiveKit classroom server (signaling).
  "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://api.stripe.com wss://*.borivon.com https://*.borivon.com",
  "frame-src 'self' blob: https://drive.google.com https://www.youtube.com https://www.loom.com https://challenges.cloudflare.com https://js.stripe.com https://checkout.stripe.com",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  // Force HTTPS for 2 years, include subdomains, opt into HSTS preload.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Block MIME-sniffing — browser must trust the declared Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block this page being framed by any non-same origin (legacy clickjacking
  // protection — modern browsers use CSP frame-ancestors above).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Minimize referrer leakage to third-party origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable the legacy XSS auditor (it's been removed from modern browsers but
  // the header still triggers an exploitable bug in older Chrome — set to 0).
  { key: "X-XSS-Protection", value: "0" },
  // Lock down powerful Web APIs we don't use.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(self), interest-cohort=()" },
  // Modern omnibus protection (XSS, clickjacking, mixed content, etc.).
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
  // ESLint is skipped during build (deprecated upstream; we lint/verify
  // separately). TypeScript type-checking stays ON for Vercel builds — it's a
  // real safety net and Vercel has the RAM for it. NOTE: the cloudflare-backup
  // branch additionally sets `typescript: { ignoreBuildErrors: true }` because
  // Cloudflare's FREE build container OOMs during the type-check pass; that
  // skip is intentionally NOT here so production (Vercel) keeps the check.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Tree-shake big barrel-file libraries aggressively. Without this, each
    // `import { X } from "lib"` pulls in metadata for every export. With it,
    // imports are rewritten to direct file imports — dramatically smaller
    // client chunks on every page that touches these libraries.
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@supabase/supabase-js",
      "react-pdf",
    ],
  },
  // Drop console.* and debugger from production builds (keep error/warn so
  // genuine production diagnostics still surface in browser tools).
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },
  serverExternalPackages: ["@react-pdf/renderer"],
  // Ensure font/logo files used by the PDF generator are included in the
  // serverless function bundle — Vercel's file tracer misses dynamic path.join refs.
  outputFileTracingIncludes: {
    "/api/portal/cv/generate": ["./public/fonts/**", "./public/logos/**"],
    "/api/portal/admin/b2-report": ["./public/fonts/**"],
    // The Motivationsschreiben (cover letter) route renders with @react-pdf +
    // Lexend too. Without bundling the fonts here, Vercel's tracer misses the
    // dynamic path.join() in lib/pdf-fonts.ts, fs.readFileSync fails, and the
    // loader falls back to fetching the font over HTTP — which loads the BOLD
    // font unreliably and dropped the first glyph of the bold Betreff
    // ("Motivationsschreiben" → "otivationsschreiben"). Bundling the fonts
    // makes the on-disk data-URI path work, exactly like the CV route.
    "/api/portal/letter/generate": ["./public/fonts/**"],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any, { isServer }: { isServer: boolean }) => {
    config.resolve.alias.canvas = false;
    // PERF (Cloudflare Workers) — keep jsdom OUT of the server bundle.
    //
    // lib/sanitizeHtml.ts only `require("isomorphic-dompurify")` in its BROWSER
    // branch (the server branch delegates to the jsdom-free sanitizeHtmlServer),
    // but webpack statically analyses a literal require() and bundles the module
    // regardless of whether it can ever execute. Result: jsdom's whole tree —
    // 635 references, including a single 2.2MB CSSStyleProperties.js — was baked
    // into the 44MB server bundle. On Vercel that is harmless (big Node lambda);
    // on Workers the isolate must PARSE that script on every cold start, which is
    // what made every page take ~1.7s.
    //
    // Aliasing to false on the server is provably safe here: the only require is
    // guarded by `typeof window === "undefined"` returning first, so this code
    // path is unreachable on the server. The browser bundle is untouched.
    if (isServer) {
      config.resolve.alias["isomorphic-dompurify"] = false;
      config.resolve.alias.jsdom = false;
    }
    return config;
  },
  /**
   * The URLs a human actually types or pastes.
   *
   * The booking page lives at /book, but "borivon.com/bookings" is what gets
   * written on a WhatsApp message, said out loud on a call, or guessed by
   * someone who half-remembers the link. Without these, every one of those
   * landed on the CATCH-ALL (app/[slug]/page.tsx), which answers 200 with the
   * generic site shell — so the lead saw a page with no calendar on it and no
   * error to explain why. A silent wrong page is worse than a 404: nobody
   * reports it, they just do not book.
   *
   * 308 (permanent) rather than 307: the destination is not going to change, so
   * browsers and link previews can cache it, and search engines fold any link
   * equity into /book instead of splitting it.
   */
  async redirects() {
    return [
      { source: "/bookings", destination: "/book", permanent: true },
      { source: "/booking", destination: "/book", permanent: true },
      // The same slip for the per-audience links people are handed.
      { source: "/bookings/:type", destination: "/book/:type", permanent: true },
      { source: "/booking/:type", destination: "/book/:type", permanent: true },
    ];
  },

  async headers() {
    return [
      {
        // Apply to every route — pages, API, static assets.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
