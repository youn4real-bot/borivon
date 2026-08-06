import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";
import { computeChaseList } from "@/lib/chaseList";
import { chaseLang, chaseMessage, whatsappLink } from "@/lib/whatsapp";

/**
 * GET /api/portal/admin/chase
 *
 * The list of candidates who need chasing, each with the finished WhatsApp
 * message and a wa.me link. The message is built SERVER-side so the wording
 * lives in one place (lib/whatsapp) and an automated sender can later reuse it
 * verbatim without the text having to be lifted back out of a React component.
 *
 * Scoped per LAW #25: an agency admin sees only their own org's candidates.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let rows = await computeChaseList();

  // getVisibleCandidateIds returns null for the supreme admin and for a true
  // Borivon HQ sub-admin (both legitimately see everyone), and a concrete list
  // for an org-scoped admin.
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  if (visible !== null) {
    const allow = new Set(visible);
    rows = rows.filter(r => allow.has(r.userId));
  }

  const out = rows.map(r => {
    const lang = chaseLang(r.lang);
    const message = chaseMessage(r.reason, {
      firstName: r.firstName, lang, days: r.days, docType: r.docType,
    });
    return {
      userId: r.userId,
      name: r.name,
      reason: r.reason,
      detail: r.detail,
      urgency: r.urgency,
      placementReady: r.placementReady,
      batch: r.batch,
      phone: r.phone,
      lang,
      message,
      // "" when there is no dialable number — the UI shows why instead of
      // opening a broken chat.
      waLink: whatsappLink(r.phone, message),
    };
  });

  return NextResponse.json({ rows: out, count: out.length });
}
