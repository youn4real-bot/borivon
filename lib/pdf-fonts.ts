import path from "path";
import fs from "fs";
import { Font } from "@react-pdf/renderer";

let registered = false;

// Cross-platform font source:
//  • Node/Vercel (has a filesystem) → read the bundled .ttf → data URI.
//    This is the original, proven path — Vercel behaviour is unchanged.
//  • Cloudflare Workers (no disk) → readFileSync throws → fall back to
//    fetching the font over HTTP from the deployed app's /fonts/ assets.
function fontSrc(filename: string): string {
  try {
    const filePath = path.join(process.cwd(), "public", "fonts", filename);
    const buffer = fs.readFileSync(filePath);
    return `data:font/truetype;base64,${buffer.toString("base64")}`;
  } catch {
    const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
    return `${base}/fonts/${filename}`;
  }
}

export function registerPdfFonts() {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Lexend",
    fonts: [
      { src: fontSrc("Lexend-Regular.ttf"),  fontWeight: 400 },
      { src: fontSrc("Lexend-SemiBold.ttf"), fontWeight: 600 },
      { src: fontSrc("Lexend-Bold.ttf"),     fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Lato",
    fonts: [
      { src: fontSrc("Lato-Regular.ttf"), fontWeight: 400 },
      { src: fontSrc("Lato-Bold.ttf"),    fontWeight: 700 },
    ],
  });
  Font.register({
    family: "DMSerifItalic",
    src: fontSrc("DMSerifDisplay-Italic.ttf"),
  });
}
