import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const BUCKET = "sign-documents";

/**
 * GET /api/portal/admin/sign-requests?userId=<candidateId>
 * Returns all sign_requests for the given candidate with signed PDF preview URLs.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sign_requests")
    .select("id, document_name, note, status, signed_at, created_at, signed_pdf_path, pdf_storage_path, review_status, review_feedback")
    .eq("candidate_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });

  const requests = await Promise.all(
    (data ?? []).map(async (r: {
      id: string; document_name: string; note: string | null;
      status: string; signed_at: string | null; created_at: string;
      signed_pdf_path: string | null; pdf_storage_path: string | null;
      review_status: string | null; review_feedback: string | null;
    }) => {
      let signed_pdf_url: string | null = null;
      const path = r.signed_pdf_path ?? (r.status === "signed" ? r.pdf_storage_path : null);
      if (path) {
        const { data: u } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
        signed_pdf_url = u?.signedUrl ?? null;
      }
      return { id: r.id, document_name: r.document_name, note: r.note, status: r.status, signed_at: r.signed_at, created_at: r.created_at, review_status: r.review_status, review_feedback: r.review_feedback, signed_pdf_url };
    }),
  );

  return NextResponse.json({ requests });
}
