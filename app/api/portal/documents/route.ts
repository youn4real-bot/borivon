import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Legacy candidate-documents lookup. Now requires:
 *  - Authorization: Bearer <jwt>
 *  - the requested `candidateId` to equal the JWT user.id
 * (No external system can browse arbitrary candidate ids.)
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId") ?? auth.userId;
  if (!UUID_RE.test(candidateId)) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }
  if (candidateId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();

  // Verify candidate is authorized (paid + email verified)
  const { data: candidate } = await db
    .from("candidates")
    .select("id, payment_status, email_verified, name")
    .eq("id", candidateId)
    .maybeSingle();

  if (!candidate || candidate.payment_status !== "paid" || !candidate.email_verified) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: documents, error } = await db
    .from("documents")
    .select("id, file_name, file_type, uploaded_at")
    .eq("candidate_id", candidateId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("[documents GET] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ name: candidate.name, documents: documents ?? [] });
}
