import path from "path";
import { Font } from "@react-pdf/renderer";

let registered = false;

export function registerPdfFonts() {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Lexend",
    fonts: [
      { src: path.join(process.cwd(), "public", "fonts", "Lexend-Regular.ttf"),  fontWeight: 400 },
      { src: path.join(process.cwd(), "public", "fonts", "Lexend-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(process.cwd(), "public", "fonts", "Lexend-Bold.ttf"),     fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Lato",
    fonts: [
      { src: path.join(process.cwd(), "public", "fonts", "Lato-Regular.ttf"), fontWeight: 400 },
      { src: path.join(process.cwd(), "public", "fonts", "Lato-Bold.ttf"),    fontWeight: 700 },
    ],
  });
  Font.register({
    family: "DMSerifItalic",
    src: path.join(process.cwd(), "public", "fonts", "DMSerifDisplay-Italic.ttf"),
  });
}
