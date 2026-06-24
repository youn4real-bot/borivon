import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getAnonVerifyClient } from "@/lib/supabase";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { dlTokenUserId } from "@/lib/dlToken";
import { enforceUserRateLimit } from "@/lib/rateLimit";
// Type-only — never pulls the @react-pdf-importing component into the bundle.
import type { PassportDataPdfGroup } from "@/components/PassportDataDocument";

// @react-pdf/renderer can't run on Cloudflare Workers (yoga-layout needs runtime
// WASM codegen, which workerd forbids — it crashes the moment the module loads).
// So EVERY @react-pdf touchpoint here is lazy + gated: on Workers we render the
// same document with pure pdf-lib (lib/pdflib/passportData); on Vercel (Node) we
// keep the proven @react-pdf path, byte-identical output. See lib/pdflib/render.ts.
const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function renderPassportPdf(
  groups: PassportDataPdfGroup[],
  docTitle?: string,
  docSubtitle?: string,
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
  const el = createElement(PassportDataDocument, { groups, docTitle, docSubtitle }) as any;
  return toArrayBuffer(new Uint8Array(await renderToBuffer(el)));
}

/**
 * GET — iOS-safe download (iOS can't download a client blob). Small payload
 * in the query, streamed as a forced attachment. Auth via header OR a
 * short-lived signed token (?dlt=, iOS navigations can't send a header).
 * This only renders client-supplied display text into a PDF — it reads no
 * data — so a valid actor is all that's required.
 */
export async function GET(req: NextRequest) {
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

  const rl = await enforceUserRateLimit("generate", `u:${actorId}`, { limit: 100, windowMs: 60_000 });
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
    const bytes = await renderPassportPdf(payload.groups as PassportDataPdfGroup[], payload.docTitle, payload.docSubtitle);
    const name = (payload.filename || "passport_data.pdf").replace(/[\r\n"]/g, "").slice(0, 200);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    console.error("Admin passport data PDF (GET) error:", err instanceof Error ? err.message : String(err));
    return new Response("Internal error", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

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
    const bytes = await renderPassportPdf(groups, docTitle, docSubtitle);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Admin passport data PDF error:", msg);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
