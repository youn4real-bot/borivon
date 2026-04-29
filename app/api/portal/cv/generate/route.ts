import { NextRequest } from "next/server";
import path from "path";
import React from "react";
import { renderToBuffer, Font } from "@react-pdf/renderer";
import { CVDocument } from "@/components/CVDocument";
import type { CVData } from "@/components/CVDocument";
import { requireUser } from "@/lib/admin-auth";

// Register Lato font once per cold start — file-path access works on both local & Vercel
Font.register({
  family: "Lato",
  fonts: [
    { src: path.join(process.cwd(), "public", "fonts", "Lato-Regular.ttf"), fontWeight: 400 },
    { src: path.join(process.cwd(), "public", "fonts", "Lato-Bold.ttf"),    fontWeight: 700 },
  ],
});

// In-memory per-user rate limit. Renders a CV PDF is CPU-heavy; cap at
// 12 requests / 60 seconds per user. Resets on cold start (acceptable for now;
// move to Upstash for multi-instance correctness).
const RL_MAX = 12;
const RL_WINDOW_MS = 60_000;
const rl = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rl.get(userId) ?? []).filter(t => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) { rl.set(userId, arr); return true; }
  arr.push(now); rl.set(userId, arr);
  return false;
}

export async function POST(req: NextRequest) {
  // Require authentication so this expensive endpoint can't be DoS'd by anonymous traffic
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  if (rateLimited(auth.userId)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const data: CVData = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(CVDocument, { data }) as any;
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
    console.error("CV generation error:", msg);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
