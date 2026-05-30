import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// Force 2 pages with lots of lines.
function makeDoc(variant) {
  const lines = Array.from({ length: 70 }, (_, i) =>
    React.createElement(Text, { key: i, style: { fontSize: 11, marginBottom: 4 } },
      `Zeile Nummer ${i} mit etwas Text damit die Seite umbricht.`));
  let pageNumEl;
  if (variant === "A_conditional_fixed" || variant === "D_before_content" || variant === "E_full_structure") {
    pageNumEl = React.createElement(Text, {
      fixed: true,
      style: { position: "absolute", bottom: 18, left: 44, right: 44, textAlign: "right", fontSize: 9, color: "#000000" },
      render: ({ pageNumber, totalPages }) => (totalPages > 1 ? `PG ${pageNumber}/${totalPages}` : ""),
    });
  } else if (variant === "B_uncond_fixed") {
    pageNumEl = React.createElement(Text, {
      fixed: true,
      style: { position: "absolute", bottom: 18, left: 44, right: 44, textAlign: "right", fontSize: 9, color: "#000000" },
      render: ({ pageNumber, totalPages }) => `PG ${pageNumber}/${totalPages}`,
    });
  } else if (variant === "C_view_wrap_fixed") {
    pageNumEl = React.createElement(View, {
      fixed: true,
      style: { position: "absolute", bottom: 18, left: 44, right: 44, flexDirection: "row", justifyContent: "flex-end" },
    }, React.createElement(Text, {
      style: { fontSize: 9, color: "#000000" },
      render: ({ pageNumber, totalPages }) => (totalPages > 1 ? `PG ${pageNumber}/${totalPages}` : ""),
    }));
  }
  // E mirrors the REAL CVDocument: a fixed header + fixed footer + the fixed
  //   page-number (3 fixed elements), page-number declared BEFORE the content.
  const fixedHeader = React.createElement(View, { key: "h", fixed: true, style: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 18, alignItems: "center" } }, React.createElement(Text, { style: { fontSize: 22 } }, "Borivon."));
  const fixedFooter = React.createElement(View, { key: "f", fixed: true, style: { position: "absolute", bottom: 0, left: 44, right: 44, paddingBottom: 11, alignItems: "center" } }, React.createElement(Text, { style: { fontSize: 7.5 } }, "contact@borivon.com"));
  const content = React.createElement(View, { key: "c" }, ...lines);
  const children = variant.startsWith("E")
    ? [fixedHeader, fixedFooter, pageNumEl, content]
    : variant.startsWith("D") ? [pageNumEl, content] : [content, pageNumEl];
  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", style: { paddingTop: 80, paddingBottom: 56, paddingHorizontal: 44 }, wrap: true }, ...children));
}

async function dump(variant) {
  const buf = await renderToBuffer(makeDoc(variant));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let out = `\n=== ${variant} (pages: ${doc.numPages}) ===\n`;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const pg = tc.items.map(i => i.str).filter(s => s.includes("PG")).join(" ");
    out += `  page ${p}: PG-tokens => "${pg}"\n`;
  }
  return out;
}

let res = "";
for (const v of ["E_full_structure"]) {
  try { res += await dump(v); } catch (e) { res += `\n=== ${v} ERROR: ${e.message}\n`; }
}
console.log(res);
