/**
 * The gift page's POST must come from our own page. (Facility logins are the portal's own Supabase
 * logins since 2026-11-10; the earlier email-link sessions are gone.)
 */
import type { NextRequest } from "next/server";

export function sameOrigin(req: NextRequest): boolean {
  const o = req.headers.get("origin");
  if (!o) return true; // same-origin fetches from older browsers omit it
  try {
    const h = new URL(o).host;
    return h === req.nextUrl.host || h === "borivon.com" || h === "www.borivon.com";
  } catch {
    return false;
  }
}
