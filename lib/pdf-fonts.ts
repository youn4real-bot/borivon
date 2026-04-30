import path from "path";
import fs from "fs";
import { Font } from "@react-pdf/renderer";

let registered = false;

function fontDataUri(filename: string): string {
  const filePath = path.join(process.cwd(), "public", "fonts", filename);
  const buffer = fs.readFileSync(filePath);
  return `data:font/truetype;base64,${buffer.toString("base64")}`;
}

export function registerPdfFonts() {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Lexend",
    fonts: [
      { src: fontDataUri("Lexend-Regular.ttf"),  fontWeight: 400 },
      { src: fontDataUri("Lexend-SemiBold.ttf"), fontWeight: 600 },
      { src: fontDataUri("Lexend-Bold.ttf"),     fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Lato",
    fonts: [
      { src: fontDataUri("Lato-Regular.ttf"), fontWeight: 400 },
      { src: fontDataUri("Lato-Bold.ttf"),    fontWeight: 700 },
    ],
  });
  Font.register({
    family: "DMSerifItalic",
    src: fontDataUri("DMSerifDisplay-Italic.ttf"),
  });
}
