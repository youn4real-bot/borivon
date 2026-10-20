// Builds the employer landing pages served at borivon.com/pflege from their
// editable sources in content/pflege/ (the same files that are previewed as a
// claude.ai artifact).
//
//   node scripts/build-pflege.mjs
//
// Output (static files, served straight from the Cloudflare asset layer):
//   public/pflege.html            → /pflege
//   public/pflege/plattform.html  → /pflege/plattform
//
// What changes between preview and live:
//   • fonts + scripts load from /pflege/assets (no Google Fonts, no CDN: nothing
//     leaves borivon.com, which keeps the page clean under German privacy rules)
//   • the draft banner goes
//   • the testimonials stay hidden until real, consented quotes exist
//     (pass --with-voices to keep them, e.g. for an internal preview)
//   • links point inside the site (/book/clinic, /portal, /impressum …), same tab
//   • the hero photo is a file instead of an inline data URI

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "content", "pflege");
const OUT = path.join(ROOT, "public");
const withVoices = process.argv.includes("--with-voices");

const FONTS = `
@font-face { font-family: "Playfair Display"; font-style: normal; font-weight: 500 700; font-display: swap; src: url(/pflege/assets/playfair-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Playfair Display"; font-style: normal; font-weight: 500 700; font-display: swap; src: url(/pflege/assets/playfair-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Playfair Display"; font-style: italic; font-weight: 400 700; font-display: swap; src: url(/pflege/assets/playfair-italic-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Playfair Display"; font-style: italic; font-weight: 400 700; font-display: swap; src: url(/pflege/assets/playfair-italic-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Lexend"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/lexend-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Lexend"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/lexend-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
`;

const META = {
  title: "Pflegefachkräfte, die bleiben · Borivon",
  description: "Pflegefachkräfte für Kliniken und Pflegeheime, direkt vom Sprachinstitut. Ein Interview, wir machen den Rest. 3-Monats-Bleibegarantie, eigenes Portal mit jedem Schritt live.",
};

let problems = 0;
function swap(s, a, b, label, { all = false, optional = false } = {}) {
  const hits = s.split(a).length - 1;
  if (hits === 0) { if (!optional) { problems++; console.error("NOT FOUND:", label); } return s; }
  if (!all && hits > 1) { problems++; console.error(`AMBIGUOUS (${hits}x):`, label); return s; }
  return s.split(a).join(b);
}
function sharedLinks(s) {
  s = swap(s, 'href="https://www.borivon.com/book/clinic" target="_blank" rel="noopener"', 'href="/book/clinic"', "booking links", { all: true });
  s = swap(s, "'<a class=\"btn btn-gold\" href=\"https://www.borivon.com/book/clinic\" target=\"_blank\" rel=\"noopener\"", "'<a class=\"btn btn-gold\" href=\"/book/clinic\"", "booking link in script", { optional: true });
  s = swap(s, 'href="https://www.borivon.com/portal" target="_blank" rel="noopener"', 'href="/portal"', "portal link", { all: true });
  s = swap(s, 'href="https://www.borivon.com/impressum" target="_blank" rel="noopener"', 'href="/impressum"', "imprint link", { all: true });
  s = swap(s, 'href="https://www.borivon.com/privacy-policy" target="_blank" rel="noopener"', 'href="/privacy-policy"', "privacy link", { all: true });
  s = swap(s, '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>', '<script src="/pflege/assets/gsap.min.js"></script>', "gsap");
  s = swap(s, '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>', '<script src="/pflege/assets/ScrollTrigger.min.js"></script>', "ScrollTrigger");
  s = swap(s, '<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js"></script>', '<script src="/pflege/assets/lenis.min.js"></script>', "lenis");
  s = s.replace(/<link rel="preconnect" href="https:\/\/fonts\.g(oogleapis|static)\.com"[^>]*>\n?/g, "");
  s = s.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">\n?/g, "");
  s = swap(s, '<meta name="claude:viewport-fit-sides" content="cover">\n', "", "artifact viewport tag", { optional: true });
  return s;
}
// Structured data for the home page (borivon.com/ since 2026-10-20). No price, ever.
const HOME_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "EmploymentAgency",
  name: "Borivon",
  legalName: "Borivon LLC",
  url: "https://www.borivon.com/",
  logo: "https://borivon.com/logo.png",
  image: "https://www.borivon.com/pflege/assets/nurse.jpg",
  description: "Borivon bringt geprüfte Pflegefachkräfte nach Deutschland: Deutsch, Anerkennung, Visum und Ankommen aus einer Hand. Mit Bleibegarantie.",
  email: "contact@borivon.com",
  areaServed: ["DE"],
  availableLanguage: ["German", "French", "English", "Arabic"],
});
function head(title, description, canonical) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/favicon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="https://www.borivon.com/pflege/assets/nurse.jpg">
<meta name="theme-color" content="#0e0e10">
${canonical === "https://www.borivon.com/" ? `<script type="application/ld+json">${HOME_LD}</script>
` : ""}<style>${FONTS}</style>
`;
}

// ── offer page ───────────────────────────────────────────────────────────────
{
  let s = fs.readFileSync(path.join(SRC, "angebot.html"), "utf8");
  s = sharedLinks(s);
  s = swap(s, 'href="plattform.html"', 'href="/pflege/plattform"', "tour link");
  s = s.replace(/<title>[^<]*<\/title>\n?/, "");
  s = s.replace(/<div class="draft"[^>]*>[^<]*<\/div>\n?/, "");
  s = s.replace(/<img src="data:image\/jpeg;base64,[^"]+"/, '<img src="/pflege/assets/nurse.jpg"');
  if (!withVoices) {
    const v0 = s.indexOf("  <!-- VOICES -->"), v1 = s.indexOf("  <!-- NOT FOR EVERYONE -->");
    if (v0 > 0 && v1 > v0) s = s.slice(0, v0) + s.slice(v1); else { problems++; console.error("NOT FOUND: voices section"); }
    s = swap(s, '      <a href="#stimmen" data-t="nav_voices">Stimmen</a>\n', "", "voices nav link");
  }
  // the fragment's own <style> blocks become part of <head>; everything after is the body
  const cut = s.lastIndexOf("</style>", s.indexOf("<header")) + "</style>".length;
  const doc = `<!doctype html>
<html lang="de">
<head>
${head(META.title, META.description, "https://www.borivon.com/")}${s.slice(0, cut).trim()}
</head>
<body>
${s.slice(cut).trim()}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, "pflege.html"), doc);
}

// ── platform tour ────────────────────────────────────────────────────────────
{
  let s = fs.readFileSync(path.join(SRC, "plattform.html"), "utf8");
  s = sharedLinks(s);
  // Home IS the offer page since 2026-10-20 (app/route.ts serves it at /).
  s = swap(s, 'href="index.html"', 'href="/"', "back links", { all: true });
  s = swap(s, `$('a[href="index.html"]')`, `$('a[href="/"]')`, "back-link script", { optional: true });
  s = s.replace(/<meta charset="utf-8">\n<meta name="viewport"[^>]*>\n<title>[^<]*<\/title>\n/, () => head("Borivon Plattform · jeder Schritt live", "Jeder Schritt Ihrer neuen Pflegefachkraft, von der Bewerbung bis zur bestandenen Probezeit. 24/7 online, für Sie kostenlos.", "https://www.borivon.com/pflege/plattform"));
  fs.mkdirSync(path.join(OUT, "pflege"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "pflege", "plattform.html"), s);
}

// sanity: nothing may still reach outside servers
for (const f of [path.join(OUT, "pflege.html"), path.join(OUT, "pflege", "plattform.html")]) {
  const s = fs.readFileSync(f, "utf8");
  const ext = s.match(/(?:src|href)="https?:\/\/(?!www\.borivon\.com)[^"]+"/g) || [];
  const scripts = s.match(/<script src="https?:[^"]+"/g) || [];
  if (ext.length || scripts.length) { problems++; console.error("EXTERNAL in", path.basename(f), [...ext, ...scripts].slice(0, 5)); }
  const rx = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = rx.exec(s))) { try { new Function(m[1]); } catch (e) { problems++; console.error("SCRIPT ERROR in", path.basename(f), e.message); } }
  console.log(path.relative(ROOT, f), Math.round(s.length / 1024) + " KB");
}
if (problems) { console.error(problems + " problem(s)"); process.exit(1); }
console.log("ok" + (withVoices ? " (with testimonials)" : ""));
