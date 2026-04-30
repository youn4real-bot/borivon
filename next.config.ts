import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake lucide-react aggressively. Without this, importing 1 icon
    // pulls in barrel-file metadata for ~1500 icons. With it, each `import { X }
    // from "lucide-react"` is rewritten to a direct file import — dramatically
    // smaller client chunks on every page using PortalIcons.
    optimizePackageImports: ["lucide-react"],
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
};

export default nextConfig;
