import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const key = process.env.TENOR_API_KEY ?? "LIVDSRZULELA";

  const endpoint = q
    ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${key}&limit=24&media_filter=tinygif,gif&contentfilter=medium`
    : `https://tenor.googleapis.com/v2/featured?key=${key}&limit=24&media_filter=tinygif,gif&contentfilter=medium`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ gifs: [] });
    const data = await res.json();
    const gifs = ((data.results ?? []) as Record<string, unknown>[]).map(r => {
      const formats = r.media_formats as Record<string, { url: string }> | undefined;
      return {
        id:      r.id as string,
        title:   (r.title as string | undefined) ?? "",
        preview: formats?.tinygif?.url ?? formats?.gif?.url ?? "",
        url:     formats?.gif?.url ?? formats?.tinygif?.url ?? "",
      };
    }).filter(g => g.preview && g.url);
    return NextResponse.json({ gifs });
  } catch (e) {
    console.error("[feed/gifs] Tenor fetch failed:", e);
    return NextResponse.json({ gifs: [] });
  }
}
