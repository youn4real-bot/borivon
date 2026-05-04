import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const key = process.env.TENOR_API_KEY ?? "LIVDSRZULELA";

  // Tenor v1 API — works with the free demo key LIVDSRZULELA
  const endpoint = q
    ? `https://api.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=${key}&limit=24&media_filter=minimal&contentfilter=medium`
    : `https://api.tenor.com/v1/trending?key=${key}&limit=24&media_filter=minimal&contentfilter=medium`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ gifs: [] });
    const data = await res.json();

    // v1 response: results[].media[0].{gif,tinygif}.url
    const gifs = ((data.results ?? []) as Record<string, unknown>[]).map(r => {
      const media = (r.media as Record<string, { url: string }>[]) ?? [];
      const m = media[0] ?? {};
      return {
        id:      r.id as string,
        title:   (r.title as string | undefined) ?? "",
        preview: m.tinygif?.url ?? m.gif?.url ?? "",
        url:     m.gif?.url ?? m.tinygif?.url ?? "",
      };
    }).filter(g => g.preview && g.url);

    return NextResponse.json({ gifs });
  } catch (e) {
    console.error("[feed/gifs] Tenor fetch failed:", e);
    return NextResponse.json({ gifs: [] });
  }
}
