import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CVDocument } from "@/components/CVDocument";
import type { CVData } from "@/components/CVDocument";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { getServiceSupabase } from "@/lib/supabase";
import { registerPdfFonts } from "@/lib/pdf-fonts";
import { sanitizeCvData } from "@/lib/cvSanitize";
import { resolveCvBrand } from "@/lib/cvRender";
import { UUID_RE } from "@/lib/uuid";

registerPdfFonts();

// Heavy server-side PDF render — give it headroom so a slow render under load
// never hits the function timeout. Vercel clamps to the plan's max.
export const maxDuration = 60;

// Max accepted POST body: 2 MB (photo data URI ≈ 160 KB; full payload well under 1 MB)
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Org/agency branding resolution now lives in lib/cvRender.ts (resolveCvBrand),
// shared with the AI bot's generate-and-publish path so both render identically.

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  // When an admin edits a candidate's CV (?candidateId=…), the rendered CV
  // must be the CANDIDATE's — including their org branding — not the admin's.
  // Gate it: only an admin/sub-admin allowed to act on that candidate.
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

  // Distributed cap (Postgres-backed, fails open to in-process): 10 renders / 60s
  // per candidate — a real shared limit, not per-Lambda. PDF render is CPU-heavy.
  const rl = await enforceUserRateLimit("generate", `u:${targetUserId}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    // SECURITY (2026-05 review): candidate-controlled body. sanitizeCvData drops
    // a non-data: `photo` (SSRF via @react-pdf remote fetch) and hard-caps array
    // dimensions (DoS via O(n²) merge + multi-thousand-page render).
    const data: CVData = sanitizeCvData(JSON.parse(rawBody) as CVData);

    // PHOTO re-injection (fixes "photo missing from generated CV"):
    // candidate_profiles.profile_photo is a Supabase Storage URL, NOT a data:
    // URL. sanitizeCvData drops any client-sent non-data: photo as an SSRF
    // guard (@react-pdf fetches <Image src> server-side), so a freshly-cropped
    // data: URL survives but a returning candidate's STORED remote URL is
    // stripped → blank photo. Re-inject the photo from the TRUSTED DB row for
    // the target candidate — the only image URL we ever let the renderer fetch.
    // A malicious client URL was already dropped above and is never restored.
    if (!data.photo) {
      const { data: prof } = await getServiceSupabase()
        .from("candidate_profiles").select("profile_photo").eq("user_id", targetUserId).maybeSingle();
      const dbPhoto = (prof as { profile_photo?: string | null } | null)?.profile_photo ?? null;
      if (dbPhoto) data.photo = dbPhoto;
    }

    // ?variant=plain → the Visa CV: NO logo, NO footer, no org/Borivon branding,
    // regardless of the candidate's branding flags. Used for the synced Visum
    // copy. Otherwise resolve normal branding (Borivon default for self).
    const plain = req.nextUrl.searchParams.get("variant") === "plain";
    const brand = plain ? { noBranding: true } : await resolveCvBrand(targetUserId, byAdmin);

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
    // Generic message to the client — don't leak library/render internals.
    return Response.json({ error: "Could not generate CV" }, { status: 500 });
  }
}
