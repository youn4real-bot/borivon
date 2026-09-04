/**
 * POST /api/portal/admin/upload-links  — mint a one-time, login-less upload link.
 *
 * An admin (LAW #25-scoped) creates a link for ONE candidate + specific missing
 * docs. Returns the full URL ONCE (borivon.com/u/<token>); only the token's
 * sha256 hash is stored. The candidate opens it and uploads without logging in.
 *
 * Schema-tolerant: if the upload_links table hasn't been migrated yet, it returns
 * a soft error (feature disabled) instead of 500 — losing a nicety, not a lead.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";
import { generateUploadToken, hashUploadToken } from "@/lib/uploadLink";
import { isUploadLinkKey } from "@/lib/uploadName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  if (!isUuid(candidateId)) return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });
  if (!(await canActOnCandidate(auth.role, auth.email, candidateId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Validate + dedupe the requested keys (passport "id" and wizard slots excluded).
  const raw = Array.isArray(body.docKeys) ? body.docKeys : [];
  const docKeys = [...new Set(raw.filter(isUploadLinkKey))].slice(0, 10);
  if (docKeys.length === 0) return NextResponse.json({ error: "No valid documents selected" }, { status: 400 });

  const token = generateUploadToken();
  const token_hash = await hashUploadToken(token);

  const db = getServiceSupabase();
  const { error } = await db.from("upload_links").insert({
    token_hash,
    candidate_user_id: candidateId,
    doc_keys: docKeys,
    created_by: auth.email ?? null,
  });
  if (error) {
    // Missing table / column → feature not set up yet. Degrade gracefully.
    if (/upload_links|relation .* does not exist|schema cache|column/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "Upload links are not enabled yet (run the migration)." }, { status: 503 });
    }
    console.error("[upload-links POST]", error.message);
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  }

  const url = `${req.nextUrl.origin}/u/${token}`;
  return NextResponse.json({ url });
}
