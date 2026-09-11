import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnOrg } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const slotId = req.nextUrl.searchParams.get("slotId");
  if (!slotId || !UUID_RE.test(slotId))
    return NextResponse.json({ error: "slotId required" }, { status: 400 });

  const db   = getServiceSupabase();

  // SAME SCOPE AS THE UPLOAD BELOW. Reading was left open while writing was
  // gated, so an org admin at one agency could pull another agency's template
  // PDFs — their Arbeitsvertrag, Vorabzustimmung, EzB — complete with employer
  // name, Betriebsnummer and contract terms, just by passing a slotId. The ids
  // are not secret; the slot list hands them out.
  const { data: slot } = await db.from("phase_slots").select("org_id").eq("id", slotId).maybeSingle();
  if (!slot) return new NextResponse("Not found", { status: 404 });
  if (!(await canActOnOrg(auth.role, auth.email, (slot as { org_id: string | null }).org_id))) {
    return new NextResponse("Not found", { status: 404 }); // 404, not 403 — don't confirm the slot exists
  }

  const path = `slot-templates/${slotId}.pdf`;

  const { data: blob, error } = await db.storage.from(BUCKET).download(path);
  if (error || !blob) return new NextResponse("Not found", { status: 404 });

  const buf = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(buf, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "private, no-store" },
  });
}

const BUCKET  = "slot-templates";

async function ensureBucket(db: ReturnType<typeof getServiceSupabase>) {
  const { error } = await db.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists|resource already/i.test(error.message)) {
    console.warn("[slot-template] bucket create warning:", error.message);
  }
}

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
  await ensureBucket(db);

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
  // Copy it into `slot-templates/archive/<slotId>_<timestamp>.pdf` so prior
  // versions of the PDF stay recoverable indefinitely. supabase-js reports
  // storage failures in `error` rather than throwing, so every step is checked
  // and an existing template that can't be archived aborts BEFORE the
  // overwrite. Existence comes from list(), not from a failed download — a
  // download error can't be told apart from "no template yet" reliably.
  const { data: listed, error: listErr } = await db.storage.from(BUCKET)
    .list("slot-templates", { limit: 100, search: `${slotId}.pdf` });
  if (listErr) {
    console.error("[slot-template POST] could not check for an existing template — aborting:", listErr);
    return NextResponse.json({ error: "Could not archive the previous version" }, { status: 500 });
  }
  if ((listed ?? []).some(o => o.name === `${slotId}.pdf`)) {
    const { data: existing, error: dlErr } = await db.storage.from(BUCKET).download(path);
    if (dlErr || !existing) {
      console.error("[slot-template POST] could not read the existing template — aborting:", dlErr);
      return NextResponse.json({ error: "Could not archive the previous version" }, { status: 500 });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = `slot-templates/archive/${slotId}_${stamp}.pdf`;
    const { error: archErr } = await db.storage.from(BUCKET).upload(archivePath, await existing.arrayBuffer(), {
      contentType: "application/pdf", upsert: false,
    });
    if (archErr) {
      console.error("[slot-template POST] archive upload failed — aborting:", archErr);
      return NextResponse.json({ error: "Could not archive the previous version" }, { status: 500 });
    }
  }

  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });

  if (upErr) {
    console.error("[slot-template POST]", upErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Persist path on the slot
  const { error: slotErr } = await db.from("phase_slots").update({ template_pdf_path: path }).eq("id", slotId);
  if (slotErr) {
    console.error("[slot-template POST] phase_slots update failed:", slotErr.message);
    return NextResponse.json({ error: "Template stored but the slot could not be updated" }, { status: 500 });
  }

  return NextResponse.json({ path });
}
