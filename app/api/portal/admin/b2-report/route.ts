import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { normalizeB2Stage, effectiveB2Stage, B2_STAGE_BY_KEY, isB2CertDoc } from "@/lib/b2Journey";
import { germanSummary } from "@/lib/b2Detail";
import type { B2ReportRow } from "@/components/B2ReportDocument";

// @react-pdf can't run on Cloudflare Workers (yoga WASM). On Workers we render the
// report with pure pdf-lib (lib/pdflib/b2report); on Vercel we keep @react-pdf,
// imported lazily so loading this route never yoga-crashes the worker.
const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

async function renderB2Report(rows: B2ReportRow[], generatedAt: string): Promise<ArrayBuffer> {
  const toAb = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  if (ON_WORKERS) {
    const { renderB2ReportPdf } = await import("@/lib/pdflib/b2report");
    return toAb(await renderB2ReportPdf(rows, generatedAt));
  }
  const [{ renderToBuffer }, { createElement }, { B2ReportDocument }, { registerPdfFonts }] =
    await Promise.all([
      import("@react-pdf/renderer"),
      import("react"),
      import("@/components/B2ReportDocument"),
      import("@/lib/pdf-fonts"),
    ]);
  registerPdfFonts();
  const element = createElement(B2ReportDocument, { rows, generatedAt }) as Parameters<typeof renderToBuffer>[0];
  return toAb(new Uint8Array(await renderToBuffer(element)));
}

/**
 * B2-status report PDF for one or many candidates (admin "where is everyone in
 * their German B2" download). Admin-gated; non-supreme admins are scoped to
 * candidates they may act on (LAW #25). Built with @react-pdf so it matches the
 * CV builder's design (Lexend body · "Borivon." logo header · contact footer).
 * Pulls the REAL German detail from each candidate's cv_draft, not just the
 * coarse pipeline stage. Read-only — a summary report, not the certificate files.
 *
 * POST { userIds: string[] } → application/pdf
 */
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
    db.from("candidate_profiles").select("user_id, first_name, last_name, b2_stage, b2_failed, b2_exam_date, cv_draft").in("user_id", ids),
    db.from("documents").select("*").in("user_id", ids), // '*' so a not-yet-migrated superseded_at never errors
  ]);

  const docsByUser = new Map<string, { file_type: string | null; status: string | null }[]>();
  for (const d of (docs ?? []) as { user_id: string; file_type: string | null; status: string | null; superseded_at?: string | null }[]) {
    if (d.superseded_at) continue; // skip ARCHIVED docs (LAW #33)
    const arr = docsByUser.get(d.user_id) ?? [];
    arr.push({ file_type: d.file_type, status: d.status });
    docsByUser.set(d.user_id, arr);
  }

  const rows: B2ReportRow[] = (profs ?? []).map((p: { user_id: string; first_name: string | null; last_name: string | null; b2_stage: string | null; b2_failed: boolean | null; b2_exam_date: string | null; cv_draft: unknown }) => {
    const d = docsByUser.get(p.user_id) ?? [];
    const stage = effectiveB2Stage(normalizeB2Stage(p.b2_stage), d);
    const certApproved = d.some((x) => x.status === "approved" && isB2CertDoc(x.file_type));
    const certPending = !certApproved && d.some((x) => isB2CertDoc(x.file_type));
    const g = germanSummary(p.cv_draft);
    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—",
      stage,
      failed: p.b2_failed === true,
      cert: certApproved ? "approved" : certPending ? "pending" : "none",
      examDate: p.b2_exam_date ?? null,
      german: g.summary,
      germanLevel: g.level,
    };
  });
  // Furthest-along first, then by name.
  rows.sort((a, b) => (B2_STAGE_BY_KEY[b.stage].position - B2_STAGE_BY_KEY[a.stage].position) || a.name.localeCompare(b.name));

  const reportDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());

  const arrayBuffer = await renderB2Report(rows, reportDate);

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="b2-status-${reportDate.replace(/\./g, "-")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
