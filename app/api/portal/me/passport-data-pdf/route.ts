import { NextRequest } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getAnonVerifyClient } from "@/lib/supabase";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { dlTokenUserId } from "@/lib/dlToken";
import { enforceRateLimitDistributed, enforceUserRateLimit } from "@/lib/rateLimit";
// Type-only — never pulls the @react-pdf-importing component into the bundle.
import type { PassportDataPdfGroup } from "@/components/PassportDataDocument";

// Heavy server-side PDF render — give it headroom so a slow render under load
// never hits the function timeout. Vercel clamps to the plan's max.
export const maxDuration = 60;

// @react-pdf/renderer can't run on Cloudflare Workers (yoga-layout needs runtime
// WASM codegen, forbidden by workerd). Every @react-pdf touchpoint is lazy + gated:
// on Workers render with pure pdf-lib; on Vercel keep the proven @react-pdf path.
const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function renderPdf(
  groups: PassportDataPdfGroup[],
  docTitle: string | undefined,
  docSubtitle: string | undefined,
): Promise<ArrayBuffer> {
  if (ON_WORKERS) {
    const { renderPassportDataPdf } = await import("@/lib/pdflib/passportData");
    return toArrayBuffer(await renderPassportDataPdf({ groups, docTitle, docSubtitle }));
  }
  const [{ renderToBuffer }, { createElement }, { PassportDataDocument }, { registerPdfFonts }] =
    await Promise.all([
      import("@react-pdf/renderer"),
      import("react"),
      import("@/components/PassportDataDocument"),
      import("@/lib/pdf-fonts"),
    ]);
  registerPdfFonts();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(PassportDataDocument, { groups, docTitle, docSubtitle }) as any;
  return toArrayBuffer(new Uint8Array(await renderToBuffer(element)));
}

/**
 * GET — iOS-safe download. iOS can't download a client blob (POST→blob), so
 * the small payload (passport field labels/values, ~1KB) is passed in the
 * query and the PDF is streamed as a forced attachment. Auth via header OR
 * ?access_token (iOS navigations can't send an Authorization header).
 *   ?d=<base64url JSON {groups,docTitle,docSubtitle,filename}>
 *   &dlt=<signed download token>  &dl=1
 */
export async function GET(req: NextRequest) {
  // Header JWT (fetch) OR short-lived signed token (?dlt=, iOS navigation).
  // The PDF is rendered purely from the client-supplied ?d= payload (the
  // user's own data they just typed) — we only require a valid actor.
  const header = req.headers.get("authorization");
  const headerJwt = header?.startsWith("Bearer ") ? header.slice(7) : "";
  let actorId: string | null = null;
  if (headerJwt) {
    const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(headerJwt);
    if (!error && user && !isSoftDeletedAuthUser(user)) actorId = user.id;
  } else {
    actorId = dlTokenUserId(req);
  }
  if (!actorId) return new Response("Unauthorized", { status: 401 });

  const rl = await enforceUserRateLimit("generate", `u:${actorId}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const d = req.nextUrl.searchParams.get("d") ?? "";
  if (!d || d.length > 200_000) return new Response("Bad request", { status: 400 });
  let payload: { groups?: unknown; docTitle?: string; docSubtitle?: string; filename?: string };
  try {
    const json = Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!Array.isArray(payload.groups)) return new Response("Bad request", { status: 400 });

  try {
    const bytes = await renderPdf(payload.groups as PassportDataPdfGroup[], payload.docTitle, payload.docSubtitle);
    const name = (payload.filename || "passport_data.pdf").replace(/[\r\n"]/g, "").slice(0, 200);
    return new Response(bytes, {
      headers: {
        // octet-stream so iOS Safari downloads instead of force-previewing.
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    console.error("Passport data PDF (GET) error:", err instanceof Error ? err.message : String(err));
    return new Response("Internal error", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  // PDF generation is CPU-heavy (@react-pdf font subsetting + render).
  // Without a cap an authenticated client could spray this and pin the
  // lambda. 10/min is roomy for the legitimate "download my passport
  // data sheet" flow which fires at most once per click.
  const rl = await enforceRateLimitDistributed(req, "me-passport-pdf", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests — wait a moment" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let groups: PassportDataPdfGroup[];
  let filename: string;
  let docTitle: string | undefined;
  let docSubtitle: string | undefined;
  try {
    const body = await req.json();
    groups = body.groups;
    filename = body.filename ?? "passport_data.pdf";
    docTitle = body.docTitle;
    docSubtitle = body.docSubtitle;
    if (!Array.isArray(groups)) throw new Error("invalid");
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const bytes = await renderPdf(groups, docTitle, docSubtitle);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Passport data PDF generation error:", msg);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
