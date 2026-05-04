import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const key = process.env.TENOR_API_KEY ?? "LIVDSRZULELA";

  // Tenor v1 — LIVDSRZULELA is the official free demo key (no registration needed)
  const endpoint = q
    ? `https://api.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=${key}&limit=24&contentfilter=medium&media_filter=minimal`
    : `https://api.tenor.com/v1/trending?key=${key}&limit=24&contentfilter=medium&media_filter=minimal`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) return NextResponse.json({ gifs: [] });
    const data = await res.json();

    // v1: results[].media[0].{ gif, tinygif, nanogif }.url
    const gifs = ((data.results ?? []) as Record<string, unknown>[]).flatMap(r => {
      const media = (r.media as Record<string, { url: string }>[]) ?? [];
      const m = media[0] ?? {};
      const preview = m.nanogif?.url || m.tinygif?.url || m.gif?.url || "";
      const url     = m.gif?.url     || m.tinygif?.url || "";
      if (!preview || !url) return [];
      return [{ id: r.id as string, title: (r.title as string) ?? "", preview, url }];
    });

    return NextResponse.json({ gifs });
  } catch (e) {
    console.error("[feed/gifs] Tenor fetch failed:", e);
    return NextResponse.json({ gifs: [] });
  }
}
