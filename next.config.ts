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
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss: data: blob:",
  "frame-src 'self' https://www.youtube.com https://www.loom.com https://challenges.cloudflare.com https://js.stripe.com",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()" },
  // Modern omnibus protection (XSS, clickjacking, mixed content, etc.).
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
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
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any) => {
    config.resolve.alias.canvas = false;
    return config;
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
