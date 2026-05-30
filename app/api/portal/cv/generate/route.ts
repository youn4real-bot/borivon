import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CVDocument } from "@/components/CVDocument";
import type { CVData, CVBrand } from "@/components/CVDocument";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { registerPdfFonts } from "@/lib/pdf-fonts";

registerPdfFonts();

// Per-user rate limit: 12 renders / 60 s
const RL_MAX = 12;
const RL_WINDOW_MS = 60_000;
// Max accepted POST body: 2 MB (photo data URI ≈ 160 KB; full payload well under 1 MB)
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const rl = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rl.get(userId) ?? []).filter(t => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) { rl.set(userId, arr); return true; }
  arr.push(now); rl.set(userId, arr);
  return false;
}

/**
 * Resolve org branding for a candidate's CV.
 *
 * Policy (per user 2026-05): agency / org branding is applied ONLY when an
 * admin or sub-admin is generating the CV for the candidate. When the
 * candidate themselves downloads, the CV is always the plain Borivon
 * template — no logo override, no footer override.
 *
 * Returns CVBrand{} (Borivon defaults) for self-renders.
 */
async function resolveBrand(userId: string, byAdmin: boolean): Promise<CVBrand> {
  if (!byAdmin) return {};
  const db = getServiceSupabase();

  // Two admin-only CV-branding flags model three states:
  //   agency on + borivon on  → agency logo + footer
  //   agency off + borivon on → plain Borivon (default {})
  //   anything   + borivon off → strip ALL branding (noBranding: true)
  const { data: prof } = await db
    .from("candidate_profiles")
    .select("employer_id, cv_use_agency_branding, cv_use_borivon_branding")
    .eq("user_id", userId)
    .maybeSingle();
  const p = (prof as { employer_id?: string | null; cv_use_agency_branding?: boolean | null; cv_use_borivon_branding?: boolean | null } | null);

  // "No branding" wins over everything else.
  if (p?.cv_use_borivon_branding === false) return { noBranding: true };

  const useAgency = p?.cv_use_agency_branding;
  if (useAgency === false) return {}; // plain Borivon
  const empId = p?.employer_id ?? null;

  // Branding resolution chain:
  //   1) direct candidate_organizations link (legacy + member self-signup)
  //   2) employer.agency_id from the candidate's assignment — so a candidate
  //      assigned to "UKSH Kiel (via Calmaroi)" picks up Calmaroi's branding
  //      without any extra link rows.
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
    const { data: emp } = await db
      .from("employers")
      .select("agency_id")
      .eq("id", empId)
      .maybeSingle();
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
      // Uploaded via admin panel — use the data URL directly
      brand.logoSrc = org.logo_filename;
    } else {
      // Legacy: filename in public/logos/. Read from disk on Node/Vercel; on
      // Cloudflare Workers (no filesystem) fs throws/returns false → fetch the
      // bundled /logos/ asset over HTTP. Mirrors lib/pdf-fonts.ts. Never throws
      // — a missing logo just leaves brand.logoSrc unset.
      // Guard: only safe raster filenames (no path traversal / no svg) may
      // reach disk-read or the HTTP fetch below. Rejects legacy/garbage rows.
      const safeName = /^[\w.\-]+\.(png|jpe?g|webp)$/i.test(org.logo_filename) ? org.logo_filename : null;
      const ext = safeName ? path.extname(safeName).toLowerCase() : "";
      const mime =
        ext === ".png"  ? "image/png"  :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        ext === ".webp" ? "image/webp"  :
        "image/png";
      let b64: string | null = null;
      if (safeName) {
        try {
          const logoPath = path.join(process.cwd(), "public", "logos", safeName);
          if (fs.existsSync(logoPath)) b64 = fs.readFileSync(logoPath).toString("base64");
        } catch { /* no disk → fetch below */ }
        if (!b64) {
          try {
            const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
            const res = await fetch(`${base}/logos/${safeName}`);
            if (res.ok) b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
          } catch { /* leave logo unset */ }
        }
      }
      if (b64) brand.logoSrc = `data:${mime};base64,${b64}`;
    }
  }

  if (org.footer_text) {
    // Admin-configured footer takes precedence — split on newlines so each
    // becomes its own centered footer line on every PDF page.
    brand.footerLines = org.footer_text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  }
  // No fallback — if the supreme admin hasn't configured a footer for this
  // org yet, the CV uses the default Borivon contact line. Configure per-org
  // branding at /portal/admin/organizations → expand org → Branding tab.

  return brand;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  // When an admin edits a candidate's CV (?candidateId=…), the rendered CV
  // must be the CANDIDATE's — including their org branding — not the admin's.
  // Gate it: only an admin/sub-admin allowed to act on that candidate.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const qCand = req.nextUrl.searchParams.get("candidateId");
  let targetUserId = auth.userId;
  let byAdmin = false; // true only when an admin/sub-admin renders on behalf of a candidate
  if (qCand && UUID_RE.test(qCand) && qCand !== auth.userId) {
    const adm = await requireAdminRole(req);
    if (!adm.ok || !(await canActOnCandidate(adm.role, adm.email, qCand))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    targetUserId = qCand;
    byAdmin = true;
  }

  if (rateLimited(targetUserId)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const data: CVData = JSON.parse(rawBody);
    // ?variant=plain → the Visa CV: NO logo, NO footer, no org/Borivon branding,
    // regardless of the candidate's branding flags. Used for the synced Visum
    // copy. Otherwise resolve normal branding (Borivon default for self).
    const plain = req.nextUrl.searchParams.get("variant") === "plain";
    const brand = plain ? { noBranding: true } : await resolveBrand(targetUserId, byAdmin);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(CVDocument, { data, brand }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    // Filename alignment with the upload pipeline (see app/api/portal/upload
    // buildFileName): <firstname>_<lastname>_pflegekraft_lebenslauf_de.pdf so
    // every CV that hits the candidate's machine has the same shape as the
    // doc later stored in Drive.
    const fn = (data.firstName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
    const ln = (data.lastName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
    const cvFilename = `${fn}_${ln}_pflegekraft_lebenslauf.pdf`;
    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cvFilename}"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("CV generation error:", msg, stack);
    return Response.json({ error: msg }, { status: 500 });
  }
}
