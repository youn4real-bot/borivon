import { NextRequest, NextResponse } from "next/server";
import { writesFrozen, freezeDecision, maintenanceResponse, cronSkipResponse } from "@/lib/maintenance";

/**
 * The affiliate portal is a SEPARATE surface, reachable ONLY at
 * affiliates.borivon.com. This middleware enforces that on both sides:
 *
 *  • On affiliates.borivon.com: rewrite /<token> (and /) into the /affiliate/*
 *    route tree (same app, same Worker), leaving /api, /_next and /r alone.
 *  • On any OTHER host (www.borivon.com, apex, previews): the affiliate portal
 *    is NOT served — the pretty pages redirect to the subdomain, and the
 *    affiliate API 404s. So the whole affiliate experience lives only on its
 *    own subdomain, visibly separate from the main site and the admin portal.
 *
 * The referral SHARE link (/r/<code>) intentionally stays on the main domain —
 * it sends prospective nurses to borivon.com, it is not the affiliate portal.
 * The admin's affiliate management (/portal/admin/affiliates) also stays in the
 * main portal — that's the operator's tool, not the affiliate-facing portal.
 */
const AFFILIATE_HOST = "affiliates.borivon.com";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // WRITE FREEZE (MAINTENANCE_WRITES="1", lib/maintenance.ts) — checked before
  // any host routing so no subdomain can write around it. Mutating /api/*
  // requests get a 503 the portal explains in three languages; cron routes are
  // answered "skipped" without running; /api/health and every GET pass.
  if (writesFrozen()) {
    const decision = freezeDecision(req.method, pathname);
    if (decision === "block") return maintenanceResponse(req.headers.get("accept-language"));
    if (decision === "skip-cron") return cronSkipResponse();
  }

  const host = (req.headers.get("host") || "").toLowerCase();
  const onAffiliateHost = host.startsWith("affiliates.");

  if (onAffiliateHost) {
    // Map the subdomain's clean paths into the /affiliate route tree.
    if (
      !pathname.startsWith("/affiliate") &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/_next") &&
      !pathname.startsWith("/r/")
    ) {
      const url = req.nextUrl.clone();
      url.pathname = pathname === "/" ? "/affiliate" : `/affiliate${pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Non-affiliate host → the portal is subdomain-only.
  if (pathname === "/affiliate" || pathname.startsWith("/affiliate/")) {
    // Forward a pretty page link to the subdomain (affiliate/<token> → /<token>).
    const sub = pathname === "/affiliate" ? "/" : pathname.slice("/affiliate".length);
    return NextResponse.redirect(`https://${AFFILIATE_HOST}${sub}${req.nextUrl.search}`);
  }
  if (pathname === "/api/affiliate" || pathname.startsWith("/api/affiliate/")) {
    // The affiliate API is only for the subdomain dashboard (same-origin there).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
