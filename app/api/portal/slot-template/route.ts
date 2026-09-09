import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { canReadSlotTemplate } from "@/lib/slotTemplateAccess";
import { getVisibleOrgIds } from "@/lib/admin-auth";

// Bucket name MUST match the admin's slot-template POST route. The admin route
// stores the template in the `slot-templates` bucket at object key
// `slot-templates/<slotId>.pdf`; the candidate side fetches the same path.
const BUCKET = "slot-templates";

/**
 * The BLANK original of a document slot — the candidate downloads this, fills
 * and signs it offline or in the portal, then uploads their copy back. The
 * template is never consumed: it lives in its own bucket, untouched by the
 * candidate's upload, so it stays permanently downloadable.
 *
 * EGRESS: templates are static and re-opened constantly, so this serves a
 * validator instead of the bytes wherever possible. An `ETag` derived from the
 * object's own updated_at+size lets a repeat open return **304 with no body**,
 * which costs a metadata lookup instead of re-streaming a ~400 KB PDF out of
 * Supabase. `no-cache` (revalidate, don't blind-cache) keeps that correct: swap
 * a template in the admin panel and the very next open sees the new one.
 * A daily per-candidate cap backstops anything pathological.
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return new NextResponse("Unauthorized", { status: 401 });

  const { data: authData, error: authErr } = await getAnonVerifyClient().auth.getUser(m[1].trim());
  if (authErr || !authData?.user) return new NextResponse("Unauthorized", { status: 401 });
  const callerId = authData.user.id;
  const callerEmail = (authData.user.email ?? "").toLowerCase();

  const slotId = req.nextUrl.searchParams.get("slotId");
  if (!slotId || !UUID_RE.test(slotId))
    return new NextResponse("slotId required", { status: 400 });
  const asDownload = req.nextUrl.searchParams.get("dl") === "1";

  const db = getServiceSupabase();

  // AUTHZ (LAW #25 / LAW #34): slot templates are scoped contracts. A logged-in
  // user must NOT read another agency's or another SITE's template by guessing a
  // slotId.
  //
  // employer_id is checked as carefully as org_id: an employer-scoped row keeps
  // org_id NULL, so an org-only check would classify every site's private
  // template as "global" and hand it to any authenticated user.
  const { data: slotRow, error: slotErr } = await db
    .from("phase_slots").select("org_id, employer_id, label").eq("id", slotId).maybeSingle();
  if (slotErr || !slotRow) return new NextResponse("Not found", { status: 404 });
  const slot = slotRow as { org_id: string | null; employer_id: string | null; label: string | null };

  // Staff standing. NOT a boolean: every org member gets a `sub_admins` row, so
  // "has a sub_admins row" would hand an agency admin every OTHER agency's
  // contract templates. Only the supreme admin and a true Borivon-HQ sub-admin
  // (getVisibleOrgIds → null) are unrestricted; an org-scoped account is limited
  // to the agencies it actually administers.
  const staff: "all" | readonly string[] | null = await (async () => {
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    if (callerEmail && callerEmail === adminEmail) return "all" as const;
    if (!callerEmail) return null;
    const { data: sub } = await db.from("sub_admins").select("email").eq("email", callerEmail).maybeSingle();
    if (!sub) return null;
    const visible = await getVisibleOrgIds(callerEmail);
    return visible === null ? ("all" as const) : visible;
  })();

  if (staff !== "all") {
    // Which agency does the SLOT's site belong to? Needed both to let an agency's
    // own staff read their sites' templates and to keep everyone else out.
    let slotEmployerAgencyId: string | null = null;
    if (slot.employer_id) {
      const { data: se } = await db
        .from("employers").select("agency_id").eq("id", slot.employer_id).maybeSingle();
      slotEmployerAgencyId = (se as { agency_id: string | null } | null)?.agency_id ?? null;
    }

    // Viewer's own placement + agency links (only meaningful for a candidate).
    const { data: prof } = await db
      .from("candidate_profiles").select("employer_id").eq("user_id", callerId).maybeSingle();
    const employerId = (prof as { employer_id: string | null } | null)?.employer_id ?? null;

    let employerAgencyId: string | null = null;
    if (employerId) {
      const { data: emp } = await db
        .from("employers").select("agency_id").eq("id", employerId).maybeSingle();
      employerAgencyId = (emp as { agency_id: string | null } | null)?.agency_id ?? null;
    }

    const { data: links } = await db
      .from("candidate_organizations").select("org_id")
      .eq("candidate_user_id", callerId).eq("status", "approved");
    const approvedOrgIds = ((links ?? []) as { org_id: string }[]).map(l => l.org_id);

    const allowed = canReadSlotTemplate(
      { orgId: slot.org_id, employerId: slot.employer_id, employerAgencyId: slotEmployerAgencyId },
      { staff, employerId, employerAgencyId, approvedOrgIds },
    );
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  }

  // Burst guard (unchanged) + a DAILY ceiling so a runaway client or a scripted
  // loop can't quietly drain storage egress. Both fail open to the in-process
  // limiter, so a DB hiccup never blocks a candidate from their paperwork.
  const burst = await enforceUserRateLimit("download", `u:${callerId}`, { limit: 30, windowMs: 60_000 });
  if (!burst.ok) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } });
  const daily = await enforceUserRateLimit("tpl-day", `u:${callerId}`, { limit: 80, windowMs: 86_400_000 });
  if (!daily.ok) return new NextResponse("Daily download limit reached", { status: 429, headers: { "Retry-After": String(daily.retryAfterSec) } });

  const path = `slot-templates/${slotId}.pdf`;

  // Cheap metadata lookup → conditional request. A match returns 304 and the
  // PDF bytes never leave Supabase.
  let etag: string | null = null;
  try {
    const { data: listed } = await db.storage.from(BUCKET)
      .list("slot-templates", { limit: 1, search: `${slotId}.pdf` });
    const meta = listed?.[0] as { updated_at?: string; metadata?: { size?: number } } | undefined;
    if (meta) etag = `"${slotId}-${meta.updated_at ?? ""}-${meta.metadata?.size ?? 0}"`;
  } catch { /* metadata unavailable → fall through and serve the bytes */ }

  const cacheHeaders: Record<string, string> = {
    "Cache-Control": "private, no-cache, must-revalidate",
    ...(etag ? { ETag: etag } : {}),
  };

  if (etag && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  const { data: blob, error } = await db.storage.from(BUCKET).download(path);
  if (error || !blob) {
    console.error("[candidate slot-template GET] download failed:", JSON.stringify(error), "path:", path, "bucket:", BUCKET);
    return new NextResponse(error?.message ?? "Not found", { status: 404 });
  }

  // ASCII-safe filename (umlauts transliterate) so Content-Disposition can't be
  // broken by a label like "Verzichtserklärung".
  const safeName = (slot.label ?? "dokument")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "dokument";

  const buf = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": asDownload ? `attachment; filename="${safeName}.pdf"` : "inline",
      ...cacheHeaders,
    },
  });
}
