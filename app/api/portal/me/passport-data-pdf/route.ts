import { NextRequest } from "next/server";
import path from "path";
import React from "react";
import { renderToBuffer, Font } from "@react-pdf/renderer";
import { PassportDataDocument } from "@/components/PassportDataDocument";
import type { PassportDataPdfFields } from "@/components/PassportDataDocument";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

Font.register({
  family: "Lato",
  fonts: [
    { src: path.join(process.cwd(), "public", "fonts", "Lato-Regular.ttf"), fontWeight: 400 },
    { src: path.join(process.cwd(), "public", "fonts", "Lato-Bold.ttf"),    fontWeight: 700 },
  ],
});

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data: profile } = await db
    .from("candidate_profiles")
    .select("first_name, last_name, dob, sex, nationality, city_of_birth, country_of_birth, passport_no, passport_expiry, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages, passport_status")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (!profile || profile.passport_status !== "approved") {
    return Response.json({ error: "Passport data not approved" }, { status: 403 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(PassportDataDocument, { p: profile as PassportDataPdfFields }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    const name = [profile.first_name, profile.last_name].filter(Boolean).join("_").toLowerCase() || "passport_data";

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}_passport_data.pdf"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Passport data PDF generation error:", msg);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
