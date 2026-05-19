import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

// The Borivon wordmark, rendered to a PNG so it is PIXEL-EXACT in every
// email client (email strips custom fonts — text can never match the logo;
// an image always does, and images aren't dark-mode color-inverted).
// Primary font = Playfair Display Italic 700 (the exact site wordmark font,
// see app/layout.tsx). Fallback = bundled DM Serif Display Italic if Google
// is unreachable. Logo never changes → cached hard + memoized per instance.
export const runtime = "nodejs";

let cachedFont: ArrayBuffer | null = null;

async function getFont(): Promise<ArrayBuffer> {
  if (cachedFont) return cachedFont;
  try {
    // Google serves TTF to legacy UAs (woff2 to modern) — force TTF for Satori.
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700",
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0)" } },
    ).then(r => r.text());
    const m = css.match(/src:\s*url\(([^)]+\.ttf)\)/);
    if (m) {
      cachedFont = await fetch(m[1]).then(r => r.arrayBuffer());
      return cachedFont!;
    }
  } catch { /* fall through to the bundled serif-italic */ }
  const buf = fs.readFileSync(path.join(process.cwd(), "public/fonts/DMSerifDisplay-Italic.ttf"));
  cachedFont = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return cachedFont;
}

export async function GET() {
  const font = await getFont();
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#fcfaf7",
          fontFamily: "Brand",
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 110,
          letterSpacing: "-0.01em",
        }}
      >
        <span style={{ color: "#1a1b1d" }}>Borivon</span>
        <span style={{ color: "#c9a240", fontStyle: "normal" }}>.</span>
      </div>
    ),
    {
      width: 560,
      height: 180,
      fonts: [{ name: "Brand", data: font, style: "italic", weight: 700 }],
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
