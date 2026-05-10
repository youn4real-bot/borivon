import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const BUCKET = "sign-documents";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sign_requests")
    .select("id, document_name, note, status, signed_at, created_at, pdf_storage_path, signed_pdf_path, signature_zone, viewed_at")
    .eq("candidate_user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });

  // Stamp viewed_at on pending requests that haven't been seen yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unseenIds = (data ?? []).filter((r: any) => r.status === "pending" && !r.viewed_at).map((r: any) => r.id as string);
  if (unseenIds.length > 0) {
    await db.from("sign_requests")
      .update({ viewed_at: new Date().toISOString() })
      .in("id", unseenIds);
  }

  // Generate 1-hour preview URLs for pending PDFs
  const requests = await Promise.all(
    (data ?? []).map(async (r: {
      id: string; document_name: string; note: string | null;
      status: string; signed_at: string | null; created_at: string;
      pdf_storage_path: string | null; signed_pdf_path: string | null;
      signature_zone: string | null; viewed_at: string | null;
    }) => {
      let pdf_preview_url: string | null = null;
      // For pending: use original path. For signed: prefer signed_pdf_path (has all signatures),
      // fall back to pdf_storage_path which is overwritten with signed bytes on candidate sign.
      const pathToFetch = r.status === "signed"
        ? (r.signed_pdf_path ?? r.pdf_storage_path)
        : r.pdf_storage_path;
      if (pathToFetch) {
        const { data: urlData } = await db.storage
          .from(BUCKET)
          .createSignedUrl(pathToFetch, 3600);
        pdf_preview_url = urlData?.signedUrl ?? null;
      }
      let signature_zone = null;
      if (r.signature_zone) {
        try { signature_zone = JSON.parse(r.signature_zone); } catch { /* ignore */ }
      }
      return {
        id: r.id,
        document_name: r.document_name,
        note: r.note,
        status: r.status,
        signed_at: r.signed_at,
        created_at: r.created_at,
        signature_zone,
        pdf_preview_url,
      };
    }),
  );

  return NextResponse.json({ requests });
}
