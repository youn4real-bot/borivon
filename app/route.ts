import { loadPublicAsset } from "@/lib/pdflib/assets";

/**
 * borivon.com/ = the nurse-placement page. Founder, 2026-10-20: "make the actual
 * borivon.com disappear and replace it with borivon.com/pflege — from now on
 * Borivon is only for nurses."
 *
 * The page is the static public/pflege.html (built from content/pflege by
 * scripts/build-pflege.mjs), served byte for byte. It is NOT public/index.html:
 * static assets answer before the app on EVERY host, so an index.html would also
 * replace affiliates.borivon.com/, which the middleware rewrites to /affiliate.
 * A route keeps that host routing intact. /pflege keeps working (cold-email
 * links); the page's canonical points here.
 *
 * The old language-school homepage (components/ClientPage) is no longer routed.
 */
export const dynamic = "force-dynamic";

let cached: string | null = null;

async function homeHtml(): Promise<string> {
  if (cached) return cached;
  // Disk name in dev, extensionless on Workers (assets html_handling serves
  // pflege.html at /pflege).
  for (const key of ["pflege.html", "pflege"]) {
    try {
      const bytes = await loadPublicAsset(key);
      if (bytes.length) {
        cached = new TextDecoder().decode(bytes);
        return cached;
      }
    } catch { /* next key */ }
  }
  throw new Error("home page (public/pflege.html) not found");
}

async function respond(method: "GET" | "HEAD"): Promise<Response> {
  const html = await homeHtml();
  return new Response(method === "HEAD" ? null : html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export async function GET() {
  return respond("GET");
}

export async function HEAD() {
  return respond("HEAD");
}
