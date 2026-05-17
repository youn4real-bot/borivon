import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const key = process.env.GIPHY_API_KEY ?? "";

  const endpoint = q
    ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=en`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) {
      console.error("[feed/gifs] GIPHY upstream status:", res.status);
      return NextResponse.json({ gifs: [] });
    }
    const data = await res.json();

    // GIPHY: data[].images.{ fixed_height_small, fixed_width, original }.url
    const gifs = ((data.data ?? []) as Record<string, unknown>[]).flatMap(r => {
      const images = r.images as Record<string, { url: string; mp4?: string }> | undefined;
      if (!images) return [];
      const preview = images.fixed_height_small?.url || images.fixed_width?.url || "";
      const url     = images.original?.url || images.fixed_height?.url || preview;
      if (!preview || !url) return [];
      return [{ id: r.id as string, title: (r.title as string) ?? "", preview, url }];
    });

    return NextResponse.json({ gifs });
  } catch (e) {
    console.error("[feed/gifs] GIPHY fetch failed:", e);
    return NextResponse.json({ gifs: [] });
  }
}
