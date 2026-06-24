/**
 * Server-side CV rendering + publishing, shared by the web route and the AI bot.
 *
 *  - resolveCvBrand(userId, byAdmin): the org/agency branding for an
 *    admin-generated CV (logo + footer), or {} for the plain Borivon template.
 *    Extracted from app/api/portal/cv/generate so both surfaces stay identical.
 *  - renderCandidateCvPdf(userId, {plain}): render the candidate's STORED
 *    cv_draft to a PDF buffer (essentials with branding, or the no-logo Visum).
 *  - publishCandidateCv(userId): render the essentials CV and store it as the
 *    candidate's official `cv_de` document (R2 + documents row, status
 *    'approved' since it's admin-generated — LAW #15). This is the bot's
 *    "generate + publish the CV" action.
 *
 * Heavy (@react-pdf/renderer) — import LAZILY from the bot path so the dep isn't
 * pulled into every assistant turn.
 */
import { createHash } from "crypto";
import type { CVData, CVBrand } from "@/components/CVDocument";
import { getServiceSupabase } from "@/lib/supabase";
import { sanitizeCvData } from "@/lib/cvSanitize";
import { candidateKey, r2Put } from "@/lib/r2";
import { FILE_KEY_LABELS } from "@/lib/fileKeys";
import { CV_DE_FILE_TYPES } from "@/lib/constants";

// @react-pdf/renderer can't run on Cloudflare Workers (yoga-layout needs runtime
// WASM codegen, which workerd forbids). On Workers we render the CV with pure
// pdf-lib (lib/pdflib/cv — verified pixel-identical to the @react-pdf output); on
// Vercel we keep @react-pdf. CRITICAL: @react-pdf + its fonts are imported LAZILY
// (only inside the non-Workers branch) so merely importing this module — the bot
// lazy-loads it on every CV action — never evaluates yoga on workerd.
const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

/** Render CV data → PDF bytes. pdf-lib on Workers, @react-pdf on Vercel. */
export async function renderCvBuffer(data: CVData, brand?: CVBrand): Promise<Uint8Array> {
  if (ON_WORKERS) {
    const { renderCvPdf } = await import("@/lib/pdflib/cv");
    return renderCvPdf(data, brand);
  }
  const [{ renderToBuffer }, { createElement }, { CVDocument }, { registerPdfFonts }] =
    await Promise.all([
      import("@react-pdf/renderer"),
      import("react"),
      import("@/components/CVDocument"),
      import("@/lib/pdf-fonts"),
    ]);
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(CVDocument, { data, brand }) as any;
  return new Uint8Array(await renderToBuffer(element));
}

type RenderResult = { ok: true } | { ok: false; error: string };

/** Org/agency branding for an admin-generated CV. {} = plain Borivon. */
export async function resolveCvBrand(userId: string, byAdmin: boolean): Promise<CVBrand> {
  if (!byAdmin) return {};
  const db = getServiceSupabase();

  const { data: prof } = await db
    .from("candidate_profiles")
    .select("employer_id, cv_use_agency_branding, cv_use_borivon_branding")
    .eq("user_id", userId)
    .maybeSingle();
  const p = prof as { employer_id?: string | null; cv_use_agency_branding?: boolean | null; cv_use_borivon_branding?: boolean | null } | null;

  if (p?.cv_use_borivon_branding === false) return { noBranding: true };
  const useAgency = p?.cv_use_agency_branding;
  if (useAgency === false) return {};
  const empId = p?.employer_id ?? null;

  let orgId: string | null = null;
  const { data: link } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", userId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (link?.org_id) orgId = link.org_id;

  if (!orgId && empId) {
    const { data: emp } = await db.from("employers").select("agency_id").eq("id", empId).maybeSingle();
    const agId = (emp as { agency_id?: string | null } | null)?.agency_id ?? null;
    if (agId) orgId = agId;
  }
  if (!orgId) return {};

  const { data: org } = await db
    .from("organizations")
    .select("name, logo_filename, footer_text")
    .eq("id", orgId)
    .single();
  if (!org) return {};

  const brand: CVBrand = {};
  if (org.logo_filename) {
    if (org.logo_filename.startsWith("data:")) {
      brand.logoSrc = org.logo_filename;
    } else {
      const safeName = /^[\w.\-]+\.(png|jpe?g|webp)$/i.test(org.logo_filename) ? org.logo_filename : null;
      const ext = (safeName?.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
      if (safeName) {
        try {
          // Cross-platform: disk on Vercel, the ASSETS binding on Workers (org
          // logos live in /public/logos, bundled into the worker assets).
          const { loadPublicAsset } = await import("@/lib/pdflib/assets");
          const bytes = await loadPublicAsset(`logos/${safeName}`);
          brand.logoSrc = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
        } catch { /* logo unavailable → text-logo fallback */ }
      }
    }
  }
  if (org.footer_text) {
    brand.footerLines = org.footer_text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  }
  return brand;
}

/** Render the candidate's STORED CV draft → PDF buffer. plain=true → no-logo Visum CV. */
export async function renderCandidateCvPdf(
  userId: string,
  opts: { plain?: boolean } = {},
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const db = getServiceSupabase();
  const { data: prof } = await db
    .from("candidate_profiles")
    .select("cv_draft, profile_photo")
    .eq("user_id", userId)
    .maybeSingle();
  const draftRaw = (prof as { cv_draft?: unknown } | null)?.cv_draft;
  if (!draftRaw) return null;

  let data: CVData;
  try {
    data = (typeof draftRaw === "string" ? JSON.parse(draftRaw) : draftRaw) as CVData;
  } catch {
    return null;
  }

  // SSRF + DoS guard, then re-inject the trusted stored photo (sanitize drops
  // every non-data: URL). Mirrors cv/generate + cv/visa.
  sanitizeCvData(data);
  const photo = (prof as { profile_photo?: string | null } | null)?.profile_photo ?? null;
  if (photo) data.photo = photo;

  const brand: CVBrand = opts.plain ? { noBranding: true } : await resolveCvBrand(userId, true);
  const buffer = await renderCvBuffer(data, brand);

  const fn = (data.firstName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
  const ln = (data.lastName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
  const fileName = `${fn}_${ln}_pflegekraft_lebenslauf${opts.plain ? "_visum" : ""}.pdf`;
  return { bytes: Buffer.from(buffer), fileName };
}

/** Render the essentials CV and publish it as the candidate's official cv_de
 *  document (R2 + documents row). status 'approved' — it's admin-generated. */
export async function publishCandidateCv(userId: string): Promise<RenderResult> {
  const rendered = await renderCandidateCvPdf(userId, { plain: false });
  if (!rendered) return { ok: false, error: "no_cv_data" };

  const db = getServiceSupabase();
  const r2Key = candidateKey(userId, `${Date.now()}_${rendered.fileName}`);
  try {
    await r2Put(r2Key, rendered.bytes, "application/pdf");
  } catch (e) {
    console.error("[publishCandidateCv] r2Put failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "store_failed" };
  }

  // file_type MUST be a cv_de label that is ALSO in CV_DE_FILE_TYPES — that's
  // the exact list the email-attach query, dashboard CV slot, and verification
  // logic match on. FILE_KEY_LABELS["cv_de"][0] is the first *translation*
  // (language order not guaranteed German), so pick the label present in both
  // sets; only then fall back. This keeps the published CV recognised as the CV
  // everywhere (dashboard slot, "send X's CV", verified-status).
  const cvLabels = FILE_KEY_LABELS["cv_de"] ?? [];
  const fileType =
    cvLabels.find((l) => (CV_DE_FILE_TYPES as readonly string[]).includes(l)) ??
    CV_DE_FILE_TYPES[0] ??
    "Lebenslauf (DE)";
  const baseRow = {
    user_id: userId,
    file_name: rendered.fileName,
    file_path: `r2/${userId}/${Date.now()}`,
    file_type: fileType,
    r2_key: r2Key,
    uploaded_by_admin: true,
    status: "approved", // admin-generated CV is green immediately (LAW #15)
  };
  const sha = createHash("sha256").update(rendered.bytes).digest("hex");
  const { error } = await db.from("documents").insert({ ...baseRow, file_sha256: sha });
  if (error) {
    const msg = (error as { message?: string })?.message ?? "";
    // Schema-tolerant: retry WITHOUT file_sha256 but ALWAYS keep r2_key
    // (the store of record — incident 2026-06-09).
    if (/file_sha256|column .* does not exist|schema cache/i.test(msg)) {
      const { error: retryErr } = await db.from("documents").insert(baseRow);
      if (retryErr) return { ok: false, error: "write_failed" };
      return { ok: true };
    }
    if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "documents_not_set_up" };
    return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}
