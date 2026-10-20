import { PLATTFORM_HTML } from "@/lib/generated/pflegePages";

/**
 * borivon.com/plattform = the platform tour (was /pflege/plattform, which now
 * redirects here). Same build as the home page: see app/route.ts.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
};

export function GET() {
  return new Response(PLATTFORM_HTML, { headers: HEADERS });
}

export function HEAD() {
  return new Response(null, { headers: HEADERS });
}
