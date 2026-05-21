import { NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { LetterDocument } from "@/components/LetterDocument";
import type { LetterData, LetterBrand } from "@/components/LetterDocument";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { registerPdfFonts } from "@/lib/pdf-fonts";
import path from "path";
import fs from "fs";

registerPdfFonts();

const RL_MAX = 20;
const RL_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 256 * 1024;
const rl = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rl.get(userId) ?? []).filter(t => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) { rl.set(userId, arr); return true; }
  arr.push(now); rl.set(userId, arr);
  return false;
}

async function resolveBrand(userId: string): Promise<LetterBrand> {
  // Letter is candidate-generated only. Per user 2026-05: candidate-side
  // output is always plain Borivon — no agency / org branding override.
  // The recipient block (employer name + address) is still auto-filled in
  // the POST handler from candidate_profiles.employer_id — that is
  // separate from brand and is preserved.
  void userId;
  return {};
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  if (rateLimited(auth.userId)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const data: LetterData = JSON.parse(rawBody);

    // Resolve the recipient (employer) SERVER-SIDE from the candidate's own
    // admin assignment — never trust client-sent recipient lines, and refuse
    // to generate until an employer is assigned. Canonical: employer_id.
    const db = getServiceSupabase();
    const { data: prof } = await db
      .from("candidate_profiles")
      .select("employer_id")
      .eq("user_id", auth.userId)
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

    const brand = await resolveBrand(auth.userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(LetterDocument, { data, brand }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

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
