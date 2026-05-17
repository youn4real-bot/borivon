import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bucket name MUST match the admin's slot-template POST route. The admin route
// stores the template in the `slot-templates` bucket at object key
// `slot-templates/<slotId>.pdf`; the candidate side fetches the same path.
const BUCKET = "slot-templates";

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

  const db   = getServiceSupabase();

  // AUTHZ (audit HIGH fix): slot templates are org-scoped contracts (LAW #34).
  // A logged-in user must NOT read another org's template by guessing a
  // slotId. Allow only when the slot is global (org_id NULL), OR the caller
  // is admin/sub_admin, OR a candidate with an APPROVED link to the slot's
  // org (mirrors the visibility rule in /api/portal/phase-slots).
  const { data: slotRow, error: slotErr } = await db
    .from("phase_slots").select("org_id").eq("id", slotId).maybeSingle();
  if (slotErr || !slotRow) return new NextResponse("Not found", { status: 404 });
  const slotOrgId = (slotRow as { org_id: string | null }).org_id;
  if (slotOrgId) {
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    let allowed = !!callerEmail && callerEmail === adminEmail;
    if (!allowed && callerEmail) {
      const { data: sub } = await db
        .from("sub_admins").select("email").eq("email", callerEmail).maybeSingle();
      allowed = !!sub;
    }
    if (!allowed) {
      const { data: link } = await db
        .from("candidate_organizations")
        .select("org_id")
        .eq("candidate_user_id", callerId)
        .eq("org_id", slotOrgId)
        .eq("status", "approved")
        .maybeSingle();
      allowed = !!link;
    }
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  }

  const path = `slot-templates/${slotId}.pdf`;

  const { data: blob, error } = await db.storage.from(BUCKET).download(path);
  if (error || !blob) {
    console.error("[candidate slot-template GET] download failed:", JSON.stringify(error), "path:", path, "bucket:", BUCKET);
    return new NextResponse(error?.message ?? "Not found", { status: 404 });
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(buf, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "private, no-store" },
  });
}
