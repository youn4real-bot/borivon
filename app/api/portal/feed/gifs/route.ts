import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  // GIPHY public beta key — works for development/low traffic.
  // Replace with a production key from developers.giphy.com for high volume.
  const key = process.env.GIPHY_API_KEY ?? "dc6zaTOxFJmzC";

  const endpoint = q
    ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ gifs: [] });
    const data = await res.json();

    const gifs = ((data.data ?? []) as Record<string, unknown>[]).map(r => {
      const images = r.images as Record<string, { url: string }> | undefined;
      return {
        id:      r.id as string,
        title:   (r.title as string | undefined) ?? "",
        preview: images?.fixed_height_small?.url ?? images?.fixed_width_small?.url ?? "",
        url:     images?.original?.url ?? images?.fixed_height?.url ?? "",
      };
    }).filter(g => g.preview && g.url);

    return NextResponse.json({ gifs });
  } catch (e) {
    console.error("[feed/gifs] GIPHY fetch failed:", e);
    return NextResponse.json({ gifs: [] });
  }
}
