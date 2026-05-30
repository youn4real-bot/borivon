import fs from "fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const buf = fs.readFileSync("C:/Users/youn4/Downloads/amina_achouki_pflegekraft_lebenslauf (1).pdf");
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
console.log("pages:", doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const all = tc.items.map(i => i.str).join("");
  const hasNum = /\b[12]\s*\/\s*2\b/.test(all);
  // show the last ~60 chars (where a bottom-right page number would land in reading order)
  console.log(`PAGE ${p}: hasPageNum=${hasNum} | tail="${all.slice(-70).replace(/\s+/g, " ")}"`);
}
