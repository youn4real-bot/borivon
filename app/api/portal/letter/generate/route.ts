import { NextRequest } from "next/server";
import type { LetterData } from "@/components/LetterDocument";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { getServiceSupabase } from "@/lib/supabase";
import { VISA_RECIPIENT_LINES, VISA_SUBJECT } from "@/lib/visaLetter";
import { UUID_RE } from "@/lib/uuid";

// @react-pdf can't run on Cloudflare Workers (yoga WASM). On Workers we render the
// letter with pure pdf-lib (lib/pdflib/letter); on Vercel we keep @react-pdf. Every
// @react-pdf touchpoint is lazy so loading this route never yoga-crashes the worker.
const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

async function renderLetter(data: LetterData): Promise<ArrayBuffer> {
  const toAb = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  if (ON_WORKERS) {
    const { renderLetterPdf } = await import("@/lib/pdflib/letter");
    return toAb(await renderLetterPdf(data));
  }
  const [{ renderToBuffer }, { createElement }, { LetterDocument }, { registerPdfFonts }] =
    await Promise.all([
      import("@react-pdf/renderer"),
      import("react"),
      import("@/components/LetterDocument"),
      import("@/lib/pdf-fonts"),
    ]);
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(LetterDocument, { data }) as any;
  return toAb(new Uint8Array(await renderToBuffer(element)));
}

// Heavy server-side PDF render — give it headroom so a slow render under load
// never hits the function timeout. Vercel clamps to the plan's max.
export const maxDuration = 60;


const MAX_BODY_BYTES = 256 * 1024;

// Letter is candidate-generated only and always plain Borivon (no agency / org
// branding) — LetterDocument ignores brand entirely, so none is passed.

export async function POST(req: NextRequest) {
  // Target resolution mirrors the rest of the cover-letter routes:
  //   • ?userId=<uid> present → admin generating on a candidate's behalf
  //     (must be admin/sub_admin + canActOnCandidate). Recipient employer
  //     + rate-limit key resolve from the CANDIDATE, not the admin — this
  //     is the fix for "admin can't generate the PDF": the old code read
  //     the admin's own (empty) employer_id and 400'd "No employer
  //     assigned".
  //   • no param → candidate generating their own letter.
  const paramUid = req.nextUrl.searchParams.get("userId");
  let targetUid: string;
  if (paramUid) {
    if (!UUID_RE.test(paramUid)) return Response.json({ error: "Invalid userId" }, { status: 400 });
    const aAuth = await requireAdminRole(req);
    if (!aAuth.ok) return Response.json({ error: aAuth.error }, { status: aAuth.status });
    if (!(await canActOnCandidate(aAuth.role, aAuth.email, paramUid))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    targetUid = paramUid;
  } else {
    const auth = await requireUser(req);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    targetUid = auth.userId;
  }

  // Distributed cap (Postgres-backed, fails open to in-process): 10 renders / 60s per user.
  const rl = await enforceUserRateLimit("generate", `u:${targetUid}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const data: LetterData = JSON.parse(rawBody);
    const isVisa = req.nextUrl.searchParams.get("variant") === "visa";

    if (isVisa) {
      // Anschreiben Visum: recipient is ALWAYS the German Embassy in Rabat and
      // the Betreff is the fixed visa title — both server-authoritative, never
      // from the client, and no employer assignment required. The body / sender
      // / closing come from the candidate's own visa letter.
      data.recipientLines = VISA_RECIPIENT_LINES;
      data.subject = VISA_SUBJECT;
      data.subjectCenter = true;   // visa Betreff is centered (permanent)
      data.signSpace = true;       // printed & hand-signed → leave a signature gap above the name
    } else {
      // Essentials letter: recipient (employer) resolved SERVER-SIDE from the
      // candidate's admin assignment — never trust client recipient lines, and
      // refuse to generate until an employer is assigned. Canonical: employer_id.
      const db = getServiceSupabase();
      const { data: prof } = await db
        .from("candidate_profiles")
        .select("employer_id")
        .eq("user_id", targetUid)
        .maybeSingle();
      const employerId = (prof as { employer_id?: string } | null)?.employer_id ?? null;

      if (!employerId) {
        return Response.json({ error: "No employer assigned" }, { status: 400 });
      }
      const { data: emp } = await db
        .from("employers")
        .select("name, address_lines")
        .eq("id", employerId)
        .maybeSingle();
      const lines = (emp as { address_lines?: string[] } | null)?.address_lines;
      const employerName = (emp as { name?: string } | null)?.name ?? "";
      if (!lines || lines.length === 0) {
        return Response.json({ error: "Employer not found" }, { status: 400 });
      }
      data.recipientLines = lines;
      // Server-authoritative Betreff: prefix + real employer name (can't be
      // spoofed by the client, and works for any future non-UKSH employer).
      data.subject = `Betreff: Motivationsschreiben für eine Tätigkeit als Pflegekraft am ${employerName}`.trim();
    }

    const arrayBuffer = await renderLetter(data);

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="motivationsschreiben.pdf"',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Letter generation error:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
