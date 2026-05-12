import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const slotId = req.nextUrl.searchParams.get("slotId");
  if (!slotId || !UUID_RE.test(slotId))
    return NextResponse.json({ error: "slotId required" }, { status: 400 });

  const db   = getServiceSupabase();
  const path = `slot-templates/${slotId}.pdf`;

  const { data: blob, error } = await db.storage.from(BUCKET).download(path);
  if (error || !blob) return new NextResponse("Not found", { status: 404 });

  const buf = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(buf, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "private, no-store" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET  = "documents";

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form   = await req.formData().catch(() => null);
  const file   = form?.get("file") as File | null;
  const slotId = form?.get("slotId") as string | null;

  if (!file || file.type !== "application/pdf")
    return NextResponse.json({ error: "PDF required" }, { status: 400 });
  // Audit fix: cap PDF size at 20 MB to prevent DoS via unbounded uploads.
  // A 20 MB cap comfortably covers typical contracts / forms; if a real PDF
  // exceeds it the admin can split it before uploading.
  if (file.size > 20 * 1024 * 1024)
    return NextResponse.json({ error: "PDF too large (max 20 MB)" }, { status: 413 });
  if (!slotId || !UUID_RE.test(slotId))
    return NextResponse.json({ error: "slotId required" }, { status: 400 });

  const db = getServiceSupabase();

  // Verify slot exists + sub-admin scope
  const { data: slot } = await db.from("phase_slots").select("org_id").eq("id", slotId).maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (auth.role !== "admin") {
    const slotOrgId = (slot as { org_id: string | null }).org_id;
    if (!slotOrgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: mem } = await db
      .from("organization_members")
      .select("org_id")
      .eq("sub_admin_email", auth.email)
      .eq("org_id", slotOrgId)
      .maybeSingle();
    if (!mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bytes = await file.arrayBuffer();
  const path  = `slot-templates/${slotId}.pdf`;

  // LAW #33: archive the previous template (if any) before overwriting.
  // Move it into `slot-templates/archive/<slotId>_<timestamp>.pdf` so prior
  // versions of the PDF stay recoverable indefinitely.
  try {
    const { data: existing } = await db.storage.from(BUCKET).download(path);
    if (existing) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = `slot-templates/archive/${slotId}_${stamp}.pdf`;
      const existingBytes = await existing.arrayBuffer();
      await db.storage.from(BUCKET).upload(archivePath, existingBytes, {
        contentType: "application/pdf", upsert: false,
      });
    }
  } catch (archErr) {
    console.warn("[slot-template POST] archive step failed (non-fatal):", archErr);
  }

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });

  if (upErr) {
    console.error("[slot-template POST]", upErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Persist path on the slot
  await db.from("phase_slots").update({ template_pdf_path: path }).eq("id", slotId);

  return NextResponse.json({ path });
}
