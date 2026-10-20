import { HOME_HTML } from "@/lib/generated/pflegePages";

/**
 * borivon.com/ = the nurse-placement page. Borivon is nurses only (founder,
 * 2026-10-20: "make the actual borivon.com disappear … only keep borivon.com as
 * the main"). There is no /pflege any more; next.config redirects it here.
 *
 * The HTML is compiled into the app (lib/generated/pflegePages.ts, written by
 * scripts/build-pflege.mjs from content/pflege). Not a public/*.html file: that
 * would be a URL of its own, and an index.html would also answer
 * affiliates.borivon.com/, which the middleware rewrites to /affiliate.
 *
 * The old language-school homepage (components/ClientPage) is no longer routed.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
};

export function GET() {
  return new Response(HOME_HTML, { headers: HEADERS });
}

export function HEAD() {
  return new Response(null, { headers: HEADERS });
}
