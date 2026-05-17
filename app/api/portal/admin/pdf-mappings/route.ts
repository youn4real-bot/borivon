/**
 * Per-PDF-template field-mapping memory.
 *
 * GET  /api/portal/admin/pdf-mappings?signature=<hash>
 *   → { mappings: FieldMapping[] | null }
 *   Looks up saved mappings for a PDF whose field-name signature matches.
 *
 * POST /api/portal/admin/pdf-mappings { signature, mappings, fieldCount? }
 *   Upserts the mappings for that signature. Called when admin submits the
 *   auto-fill review modal so the next upload of the same form re-applies
 *   them without re-mapping by hand.
 *
 * Auth: any admin (supreme / sub_admin / org_admin) can read + write. There
 * is no candidate-scoping — the table maps PDF templates to field-binding
 * decisions; the same form serves many candidates.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const SIG_RE = /^[0-9a-f]{16,64}$/i;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sig = req.nextUrl.searchParams.get("signature");
  if (!sig || !SIG_RE.test(sig))
    return NextResponse.json({ error: "signature required" }, { status: 400 });
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("pdf_field_mappings")
    .select("mappings")
    .eq("signature", sig)
    .maybeSingle();
  if (error) {
    console.error("[pdf-mappings GET]", error);
    return NextResponse.json({ mappings: null });
  }
  return NextResponse.json({ mappings: (data as { mappings?: unknown } | null)?.mappings ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null) as {
    signature?: string;
    mappings?: unknown;
    fieldCount?: number;
  } | null;
  if (!body?.signature || !SIG_RE.test(body.signature))
    return NextResponse.json({ error: "signature required" }, { status: 400 });
  if (!Array.isArray(body.mappings))
    return NextResponse.json({ error: "mappings must be an array" }, { status: 400 });
  // Sanity cap — defensive: refuse absurd payloads.
  if (body.mappings.length > 500)
    return NextResponse.json({ error: "too many mappings" }, { status: 413 });

  const db = getServiceSupabase();
  const { error } = await db.from("pdf_field_mappings").upsert({
    signature:   body.signature,
    mappings:    body.mappings,
    field_count: typeof body.fieldCount === "number" ? body.fieldCount : body.mappings.length,
    updated_at:  new Date().toISOString(),
  }, { onConflict: "signature" });
  if (error) {
    console.error("[pdf-mappings POST]", error);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
