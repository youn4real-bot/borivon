/**
 * ACADEMY/VISUM — Visa CV renderer (no logo / no footer), on demand.
 *
 * The "Lebenslauf Visum" box is a CLONE of the Essentials CV: same data, same
 * state. The ONLY difference is the rendered PDF strips the Borivon/org logo +
 * footer (brand.noBranding). We render it live from the candidate's cv_draft —
 * the exact same source the Essentials CV is built from — so the two never
 * diverge and it works for every candidate immediately (no stored twin).
 *
 *   GET                      → the caller's own no-logo CV (inline preview)
 *   GET ?candidateId=<uuid>  → admin/sub-admin renders it for that candidate
 *   GET ?dl=1                → force download (attachment) instead of inline
 *
 * Self-only unless an admin allowed to act on the candidate (LAW #25).
 */
import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CVDocument } from "@/components/CVDocument";
import type { CVData } from "@/components/CVDocument";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { registerPdfFonts } from "@/lib/pdf-fonts";
import { enforceRateLimit, enforceRateLimitDistributed } from "@/lib/rateLimit";
import { sanitizeCvData } from "@/lib/cvSanitize";
import { UUID_RE } from "@/lib/uuid";

registerPdfFonts();

// Heavy server-side PDF render — give it headroom so a slow render under load
// never hits the function timeout. Vercel clamps to the plan's max.
export const maxDuration = 60;


export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rl = await enforceRateLimitDistributed(req, "cv-visa", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  // Resolve target: self, or a candidate an admin is allowed to act on.
  const qCand = req.nextUrl.searchParams.get("candidateId");
  let targetUserId = auth.userId;
  if (qCand && UUID_RE.test(qCand) && qCand !== auth.userId) {
    const adm = await requireAdminRole(req);
    if (!adm.ok || !(await canActOnCandidate(adm.role, adm.email, qCand))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    targetUserId = qCand;
  }

  const db = getServiceSupabase();
  const { data: prof } = await db
    .from("candidate_profiles").select("cv_draft, profile_photo").eq("user_id", targetUserId).maybeSingle();
  const draft = (prof as { cv_draft?: unknown } | null)?.cv_draft;
  if (!draft) return Response.json({ error: "No CV yet" }, { status: 404 });

  let data: CVData;
  try {
    data = (typeof draft === "string" ? JSON.parse(draft) : draft) as CVData;
  } catch {
    return Response.json({ error: "Bad CV data" }, { status: 500 });
  }

  // The photo is stored separately (candidate_profiles.profile_photo) and
  // STRIPPED from cv_draft to keep the row small — so re-inject it here, exactly
  // like the CV builder does on load. Without this the no-logo CV has no photo.
  const photo = (prof as { profile_photo?: string | null } | null)?.profile_photo ?? null;
  if (photo) data.photo = photo;

  // SECURITY (2026-05 review): cv_draft is candidate-controlled. sanitizeCvData
  // drops a non-data: `photo` (SSRF — would be re-rendered under the admin's
  // session via ?candidateId=) and caps array dimensions (render DoS). Runs
  // AFTER the trusted profile_photo re-injection so a real photo survives.
  sanitizeCvData(data);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(CVDocument, { data, brand: { noBranding: true } }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const fn = (data.firstName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
    const ln = (data.lastName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
    const name = `${fn}_${ln}_pflegekraft_lebenslauf_visum.pdf`;
    const dl = req.nextUrl.searchParams.get("dl") === "1";
    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${name}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Visa CV render error:", msg);
    return Response.json({ error: "Could not render CV" }, { status: 500 });
  }
}
