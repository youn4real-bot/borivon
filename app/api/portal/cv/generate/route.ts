import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CVDocument } from "@/components/CVDocument";
import type { CVData, CVBrand } from "@/components/CVDocument";
import { requireUser } from "@/lib/admin-auth";
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

/** Resolve org branding for a candidate. Returns CVBrand with Borivon defaults if no org. */
async function resolveBrand(userId: string): Promise<CVBrand> {
  const db = getServiceSupabase();

  // Find the candidate's first approved org that has a logo configured
  const { data: link } = await db
    .from("candidate_organizations")
    .select("org_id")
    .eq("candidate_user_id", userId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();

  if (!link?.org_id) return {};

  const { data: org } = await db
    .from("organizations")
    .select("name, logo_filename, footer_text")
    .eq("id", link.org_id)
    .single();

  if (!org) return {};

  const brand: CVBrand = {};

  if (org.logo_filename) {
    if (org.logo_filename.startsWith("data:")) {
      // Uploaded via admin panel — use the data URL directly
      brand.logoSrc = org.logo_filename;
    } else {
      // Legacy: filename in public/logos/
      const logoPath = path.join(process.cwd(), "public", "logos", org.logo_filename);
      if (fs.existsSync(logoPath)) {
        const ext = path.extname(org.logo_filename).toLowerCase();
        const mime =
          ext === ".png"  ? "image/png"  :
          ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".webp" ? "image/webp"  :
          ext === ".svg"  ? "image/svg+xml" :
          "image/png";
        const b64 = fs.readFileSync(logoPath).toString("base64");
        brand.logoSrc = `data:${mime};base64,${b64}`;
      }
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

  if (rateLimited(auth.userId)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const data: CVData = JSON.parse(rawBody);
    const brand = await resolveBrand(auth.userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(CVDocument, { data, brand }) as any;
    const buffer = await renderToBuffer(element);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="lebenslauf.pdf"',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("CV generation error:", msg, stack);
    return Response.json({ error: msg }, { status: 500 });
  }
}
