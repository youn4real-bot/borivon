import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PassportDataDocument } from "@/components/PassportDataDocument";
import type { PassportDataPdfGroup } from "@/components/PassportDataDocument";
import { requireUser } from "@/lib/admin-auth";
import { getAnonVerifyClient } from "@/lib/supabase";
import { registerPdfFonts } from "@/lib/pdf-fonts";

registerPdfFonts();

async function renderPdf(
  groups: PassportDataPdfGroup[],
  docTitle: string | undefined,
  docSubtitle: string | undefined,
): Promise<ArrayBuffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(PassportDataDocument, { groups, docTitle, docSubtitle }) as any;
  const buffer = await renderToBuffer(element);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * GET — iOS-safe download. iOS can't download a client blob (POST→blob), so
 * the small payload (passport field labels/values, ~1KB) is passed in the
 * query and the PDF is streamed as a forced attachment. Auth via header OR
 * ?access_token (iOS navigations can't send an Authorization header).
 *   ?d=<base64url JSON {groups,docTitle,docSubtitle,filename}>
 *   &access_token=<jwt>  &dl=1
 */
export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization");
  const headerJwt = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const queryJwt = req.nextUrl.searchParams.get("access_token") ?? "";
  const jwt = headerJwt || queryJwt;
  if (!jwt) return new Response("Unauthorized", { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return new Response("Unauthorized", { status: 401 });

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
    const arrayBuffer = await renderPdf(payload.groups as PassportDataPdfGroup[], payload.docTitle, payload.docSubtitle);
    const name = (payload.filename || "passport_data.pdf").replace(/[\r\n"]/g, "").slice(0, 200);
    return new Response(arrayBuffer, {
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
    const arrayBuffer = await renderPdf(groups, docTitle, docSubtitle);
    return new Response(arrayBuffer, {
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
