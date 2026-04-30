import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PassportDataDocument } from "@/components/PassportDataDocument";
import type { PassportDataPdfGroup } from "@/components/PassportDataDocument";
import { requireAdminRole } from "@/lib/admin-auth";
import { registerPdfFonts } from "@/lib/pdf-fonts";

registerPdfFonts();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(PassportDataDocument, { groups, docTitle, docSubtitle }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new Response(arrayBuffer, {
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
