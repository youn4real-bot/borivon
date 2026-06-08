import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { UUID_RE } from "@/lib/uuid";
import { normalizeB2Stage, effectiveB2Stage, B2_STAGE_BY_KEY, b2StageLabel, isB2CertDoc, type B2Stage } from "@/lib/b2Journey";

/**
 * B2-status report PDF for one or many candidates (admin "where is everyone in
 * their German B2" download). Admin-gated; non-supreme admins are scoped to
 * candidates they may act on (LAW #25). Read-only — builds a clean summary, not
 * the candidates' actual certificate files.
 *
 * POST { userIds: string[] } → application/pdf
 */

function hex(h: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) return rgb(0.4, 0.4, 0.4);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { userIds?: unknown };
  const rawIds: unknown[] = Array.isArray(body?.userIds) ? body.userIds : [];
  let ids: string[] = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))];
  if (ids.length === 0) return NextResponse.json({ error: "No valid candidates" }, { status: 400 });

  // Scope: non-supreme admins only get their own candidates (LAW #25).
  if (auth.role !== "admin") {
    const visible = new Set(await getVisibleCandidateIds(auth.email));
    ids = ids.filter((id) => visible.has(id));
    if (ids.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ids = ids.slice(0, 500); // sane cap

  const db = getServiceSupabase();
  const [{ data: profs }, { data: docs }] = await Promise.all([
    db.from("candidate_profiles").select("user_id, first_name, last_name, b2_stage, b2_failed, b2_exam_date").in("user_id", ids),
    db.from("documents").select("user_id, file_type, status").in("user_id", ids),
  ]);

  const docsByUser = new Map<string, { file_type: string | null; status: string | null }[]>();
  for (const d of (docs ?? []) as { user_id: string; file_type: string | null; status: string | null }[]) {
    const arr = docsByUser.get(d.user_id) ?? [];
    arr.push({ file_type: d.file_type, status: d.status });
    docsByUser.set(d.user_id, arr);
  }

  type Row = { name: string; stage: B2Stage; failed: boolean; cert: "approved" | "pending" | "none"; examDate: string | null };
  const rows: Row[] = (profs ?? []).map((p: { user_id: string; first_name: string | null; last_name: string | null; b2_stage: string | null; b2_failed: boolean | null; b2_exam_date: string | null }) => {
    const d = docsByUser.get(p.user_id) ?? [];
    const stage = effectiveB2Stage(normalizeB2Stage(p.b2_stage), d);
    const certApproved = d.some((x) => x.status === "approved" && isB2CertDoc(x.file_type));
    const certPending = !certApproved && d.some((x) => isB2CertDoc(x.file_type));
    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—",
      stage,
      failed: p.b2_failed === true,
      cert: certApproved ? "approved" : certPending ? "pending" : "none",
      examDate: p.b2_exam_date ?? null,
    };
  });
  // Furthest-along first, then by name.
  rows.sort((a, b) => (B2_STAGE_BY_KEY[b.stage].position - B2_STAGE_BY_KEY[a.stage].position) || a.name.localeCompare(b.name));

  // ── PDF ─────────────────────────────────────────────────────────────────
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4 = { w: 595.28, h: 841.89 };
  const M = 50;
  const ink = rgb(0.1, 0.1, 0.1), dim = rgb(0.45, 0.45, 0.45);

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  const newPageIfNeeded = (need: number) => {
    if (y - need < M) { page = pdf.addPage([A4.w, A4.h]); y = A4.h - M; }
  };

  // Header
  page.drawText("B2-Status — Borivon", { x: M, y: y - 4, size: 18, font: bold, color: ink });
  y -= 26;
  const reportDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  page.drawText(`${rows.length} Kandidat${rows.length === 1 ? "" : "en"} · ${reportDate}`, { x: M, y, size: 10, font, color: dim });
  y -= 22;

  // Stage summary line ("where are they")
  const counts = new Map<B2Stage, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  const summaryStages = Object.values(B2_STAGE_BY_KEY).sort((a, b) => a.position - b.position);
  let sx = M;
  for (const s of summaryStages) {
    const n = counts.get(s.key as B2Stage) ?? 0;
    if (n === 0) continue;
    page.drawCircle({ x: sx + 4, y: y + 3, size: 4, color: hex(s.color) });
    const label = `${n} ${b2StageLabel(s.key as B2Stage, "de")}`;
    page.drawText(label, { x: sx + 12, y, size: 9, font, color: dim });
    sx += 16 + font.widthOfTextAtSize(label, 9) + 16;
    if (sx > A4.w - M - 120) { sx = M; y -= 14; }
  }
  y -= 22;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 22;

  // ISO → TT.MM.JJJJ; full plain-language B2 status (no cryptic "Stufe X/5").
  const deDate = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
  const statusDe = (stage: B2Stage): string => {
    switch (stage) {
      case "passed":           return "B2 bestanden";
      case "awaiting_results": return "Prüfung abgelegt - Ergebnis ausstehend";
      case "exam_booked":      return "Prüfungstermin gebucht & bezahlt (bestätigt)";
      case "expected_date":    return "Voraussichtlicher Termin bestätigt";
      default:                 return "Lernphase - sucht noch einen Termin";
    }
  };

  // Rows
  for (const r of rows) {
    newPageIfNeeded(34);
    const def = B2_STAGE_BY_KEY[r.stage];
    page.drawCircle({ x: M + 5, y: y + 3, size: 5, color: hex(def.color) });
    page.drawText(truncate(r.name, 30), { x: M + 18, y, size: 12.5, font: bold, color: ink });
    // Clear, plain-language status (colored by stage) in a second column.
    page.drawText(truncate(statusDe(r.stage), 50), { x: 290, y, size: 10.5, font: bold, color: hex(def.color) });
    y -= 15;
    // Detail line: WHEN (exam date) · certificate state · failed nuance.
    const bits: string[] = [];
    if (r.examDate) bits.push(`Prüfungstermin: ${deDate(r.examDate)}`);
    bits.push(r.cert === "approved" ? "Zertifikat vorhanden" : r.cert === "pending" ? "Zertifikat in Prüfung" : "noch kein Zertifikat");
    if (r.failed) bits.push(r.stage === "passed" ? "bestanden nach Wiederholung" : "schon einmal nicht bestanden");
    page.drawText(bits.join("   ·   "), { x: M + 18, y, size: 9.5, font, color: dim });
    y -= 18;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4.w - M, y: y + 4 }, thickness: 0.5, color: rgb(0.92, 0.92, 0.92) });
    y -= 8;
  }

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="b2-status-${reportDate.replace(/\./g, "-")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
