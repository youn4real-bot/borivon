import { NextRequest, NextResponse } from "next/server";
import { dlTokenUserId } from "@/lib/dlToken";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";

/**
 * Serve a candidate's CURRENT CV — rendered LIVE from cv_draft (the data edited
 * in the website), NOT the last stored/published PDF. This is what the bot pulls
 * so "give me X's current CV" always matches the website, even right after an
 * edit that hasn't been re-published. Auth = a short-lived signed download token
 * (?dlt=), and the token holder must be the candidate themselves OR the supreme
 * admin (the only one the bot ever mints these for).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorId = dlTokenUserId(req);
  if (!actorId) return new NextResponse("Unauthorized", { status: 401 });

  const cand = (req.nextUrl.searchParams.get("cand") || "").trim();
  if (!UUID_RE.test(cand)) return new NextResponse("Bad request", { status: 400 });

  // Only the candidate (self) or the supreme admin may render a candidate's CV.
  if (actorId !== cand) {
    const { data } = await getServiceSupabase().auth.admin.getUserById(actorId);
    const email = (data?.user?.email ?? "").trim().toLowerCase();
    if (!email || email !== (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const rl = await enforceUserRateLimit("download", `u:${actorId}`, { limit: 60, windowMs: 60000 });
  if (!rl.ok) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const plain = req.nextUrl.searchParams.get("plain") === "1"; // no-logo Visum CV
  const { renderCandidateCvPdf } = await import("@/lib/cvRender"); // lazy — heavy react-pdf
  const rendered = await renderCandidateCvPdf(cand, { plain }).catch(() => null);
  if (!rendered) return new NextResponse("Not found", { status: 404 }); // no cv_draft → caller falls back

  const dl = req.nextUrl.searchParams.get("dl") === "1";
  const name = (req.nextUrl.searchParams.get("name") || rendered.fileName).replace(/[\r\n"]/g, "").slice(0, 200);
  return new NextResponse(new Uint8Array(rendered.bytes), {
    headers: {
      "Content-Type": dl ? "application/octet-stream" : "application/pdf",
      "Content-Disposition": dl ? `attachment; filename="${name}"` : "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
