// Builds the employer pages — borivon.com/ and borivon.com/plattform — from their
// editable sources in content/pflege/ (the same files that are previewed as a
// claude.ai artifact).
//
//   node scripts/build-pflege.mjs
//
// Output (static files, served by the Cloudflare asset layer BEFORE the app, so
// no app cold start — measured 2026-10-21: ~0.35 s vs 1.3–3 s through the app):
//   public/index.html      → borivon.com/            (the offer page)
//   public/plattform.html  → borivon.com/plattform   (the platform tour)
// Assets answer for every host, so affiliates.borivon.com/ would get the offer
// page too: the first thing in index.html's <head> sends that host to /affiliate
// (its own landing, which the middleware serves as-is on that host).
// Fonts, scripts and the photo stay in public/pflege/assets. There is no /pflege
// page (founder: borivon.com only); next.config redirects it to /.
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
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "content", "pflege");
const OUT = path.join(ROOT, "public");
const withVoices = process.argv.includes("--with-voices");
const pages = {};

// ── shared design system: content/pflege/bv.css + bv.js → public/pflege/assets, cache-busted (?v=hash) ──
// A page opts in with <!--BV--> in its <head> and <!--BVJS--> before </body>.
const BV = {};
for (const f of ["bv.css", "bv.js"]) {
  const src = fs.readFileSync(path.join(SRC, f), "utf8");
  fs.writeFileSync(path.join(OUT, "pflege", "assets", f), src);
  BV[f] = `/pflege/assets/${f}?v=${crypto.createHash("sha1").update(src).digest("hex").slice(0, 8)}`;
}
const BV_HEAD = `<script>document.documentElement.classList.add('js');setTimeout(function(){if(!window.__bvMotion)document.documentElement.classList.remove('js')},2500);</script>
<link rel="preload" href="/pflege/assets/fonts/ebgaramond-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/pflege/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/pflege/assets/fonts/ebgaramond-italic-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BV["bv.css"]}">`;
function bv(s) {
  return s.replace("<!--BV-->", BV_HEAD).replace("<!--BVJS-->", `<script src="${BV["bv.js"]}"></script>`);
}

const FONTS = `
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: 400 800; font-display: swap; src: url(/pflege/assets/fonts/ebgaramond-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: 400 800; font-display: swap; src: url(/pflege/assets/fonts/ebgaramond-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400 800; font-display: swap; src: url(/pflege/assets/fonts/ebgaramond-italic-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400 800; font-display: swap; src: url(/pflege/assets/fonts/ebgaramond-italic-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/fonts/inter-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/fonts/inter-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Playfair Display"; font-style: normal; font-weight: 500 700; font-display: swap; src: url(/pflege/assets/playfair-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Playfair Display"; font-style: normal; font-weight: 500 700; font-display: swap; src: url(/pflege/assets/playfair-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Playfair Display"; font-style: italic; font-weight: 400 700; font-display: swap; src: url(/pflege/assets/playfair-italic-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Playfair Display"; font-style: italic; font-weight: 400 700; font-display: swap; src: url(/pflege/assets/playfair-italic-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Lexend"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/lexend-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Lexend"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/pflege/assets/lexend-latin-ext.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
`;

// Home = free value first, the workshop is the one paid step (founder 2026-11-09). No nurse sales talk.
const META = {
  title: "Borivon · Pflegekräfte gewinnen und halten",
  description: "Der Pflege-Fahrplan für Gesundheitseinrichtungen: Ihre Stufe, was leere Stellen Sie kosten, Ihr Zeitplan und Ihr 90-Tage-Plan, damit Pflegekräfte bleiben. In unter 60 Sekunden.",
};

let problems = 0;
function swap(s, a, b, label, { all = false, optional = false } = {}) {
  const hits = s.split(a).length - 1;
  if (hits === 0) { if (!optional) { problems++; console.error("NOT FOUND:", label); } return s; }
  if (!all && hits > 1) { problems++; console.error(`AMBIGUOUS (${hits}x):`, label); return s; }
  return s.split(a).join(b);
}
function sharedLinks(s) {
  s = swap(s, 'href="https://www.borivon.com/book/clinic" target="_blank" rel="noopener"', 'href="/book/clinic"', "booking links", { all: true, optional: true }); // none left since 2026-11-08: no discovery calls, buttons go to /fahrplan
  s = swap(s, "'<a class=\"btn btn-gold\" href=\"https://www.borivon.com/book/clinic\" target=\"_blank\" rel=\"noopener\"", "'<a class=\"btn btn-gold\" href=\"/book/clinic\"", "booking link in script", { optional: true });
  s = swap(s, 'href="https://www.borivon.com/portal" target="_blank" rel="noopener"', 'href="/portal"', "portal link", { all: true });
  s = swap(s, 'href="https://www.borivon.com/fahrplan" target="_blank" rel="noopener"', 'href="/fahrplan"', "roadmap links", { all: true, optional: true });
  s = swap(s, 'href="https://www.borivon.com/impressum" target="_blank" rel="noopener"', 'href="/impressum"', "imprint link", { all: true });
  s = swap(s, 'href="https://www.borivon.com/datenschutz" target="_blank" rel="noopener"', 'href="/datenschutz"', "privacy link", { all: true });
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
  "@type": "Organization",
  name: "Borivon",
  legalName: "Borivon LLC",
  url: "https://www.borivon.com/",
  logo: "https://borivon.com/logo.png",
  image: "https://www.borivon.com/pflege/assets/og-fahrplan-2.png",
  // the motto, word for word (it is how Borivon describes itself everywhere)
  description: "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
  email: "contact@borivon.com",
  areaServed: ["DE"],
  availableLanguage: ["German", "French", "English", "Arabic"],
});
function head(title, description, canonical, image = "https://www.borivon.com/pflege/assets/nurse.jpg") {
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
<meta property="og:image" content="${image}">${/\/og-[a-z]+\.(png|jpg)$/.test(image) ? `
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">` : ""}
<meta name="theme-color" content="#0e0e10">
${canonical === "https://www.borivon.com/" ? `<script type="application/ld+json">${HOME_LD}</script>
` : ""}<style>${FONTS}</style>
`;
}

// ── home page (borivon.com/) ────────────────────────────────────────────────
// Since 2026-11-09: free value (the Fahrplan, the calculator) and the workshop as the one paid step,
// like acquisition.com. The old placement sales page (angebot.html) is gone.
{
  let s = fs.readFileSync(path.join(SRC, "home.html"), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in home.html"); }
  // the affiliates host shares this page: the first thing in <head> sends it to /affiliate
  else s = s.slice(0, i) + `<script>if(location.hostname.indexOf("affiliates.")===0)location.replace("/affiliate"+location.search)</script>
` + head(META.title, META.description, "https://www.borivon.com/", "https://www.borivon.com/pflege/assets/og-fahrplan-2.png") + s.slice(i + "<!--HEAD-->".length);
  pages.HOME_HTML = bv(s);
}

// ── the platform as a premium product (founder 2026-11-10: "a separate page on it… see if you qualify") ──
{
  let s = fs.readFileSync(path.join(SRC, "plattform.html"), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in plattform.html"); }
  else s = s.slice(0, i) + head("Die Borivon-Plattform für Ihre Einrichtung", "Jede Pflegekraft, jeder Schritt, ein Ort: vom Lebenslauf über das Visum bis zum Ende der Probezeit. Als Dankeschön zu Ihrem Fahrplan.", "https://www.borivon.com/plattform", "https://www.borivon.com/pflege/assets/og-plattform.jpg") + s.slice(i + "<!--HEAD-->".length);
  pages.PLATTFORM_HTML = bv(s);
}

// ── Pflege-Fahrplan (free roadmap → personal PDF by email, app/api/roadmap) ──
{
  let s = fs.readFileSync(path.join(SRC, "fahrplan.html"), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in fahrplan.html"); }
  else s = s.slice(0, i) + head("Ihr Pflege-Fahrplan · Borivon", "In unter 60 Sekunden: was leere Stellen Sie kosten, Ihr Zeitplan bis zur ersten Fachkraft und Ihr Plan, damit sie bleibt.", "https://www.borivon.com/fahrplan", "https://www.borivon.com/pflege/assets/og-fahrplan-2.png") + s.slice(i + "<!--HEAD-->".length);
  pages.FAHRPLAN_HTML = s;
}

// ── Fahrplan-Rechner (the calculator behind the button on PDF page 4) ──
{
  let s = fs.readFileSync(path.join(SRC, "rechner.html"), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in rechner.html"); }
  else s = s.slice(0, i) + head("Ihr Rechner zum Pflege-Fahrplan · Borivon", "Was offene Stellen Sie kosten, und was Pflegekräfte bringen. Mit Ihren eigenen Zahlen, über 1, 2 und 3 Jahre.", "https://www.borivon.com/fahrplan/rechner", "https://www.borivon.com/pflege/assets/og-fahrplan-2.png") + s.slice(i + "<!--HEAD-->".length);
  pages.RECHNER_HTML = s;
}

// ── Workshop in Marokko (the paid next step, linked from the PDF last page + the emails) ──
{
  let s = fs.readFileSync(path.join(SRC, "workshop.html"), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in workshop.html"); }
  else s = s.slice(0, i) + head("Workshop in Casablanca · Borivon", "2 Tage in unseren Konferenzräumen in Casablanca, Marokko, mit dem Gründer von Borivon: Ihren Fahrplan umsetzen und Ihre Pflegekräfte persönlich kennenlernen. Alle 3 Monate, 20 Plätze.", "https://www.borivon.com/workshop", "https://www.borivon.com/pflege/assets/og-workshop.jpg") + s.slice(i + "<!--HEAD-->".length);
  // Google: each open date as an Event (no offers/price; sold-out dates left out)
  const events = [...s.matchAll(/<a class="date"[^>]*data-start="(\d{4}-\d{2}-\d{2})" data-end="(\d{4}-\d{2}-\d{2})"/g)].map(([, start, end]) => ({
    "@context": "https://schema.org", "@type": "Event",
    name: "Workshop in Casablanca: Ihr Personal-Plan in 2 Tagen",
    description: "2 Tage in unseren Konferenzräumen in Casablanca, mit Youness Taoufiq: Am ersten Tag Ihr Plan, am zweiten die Pflegekräfte dazu. Für Gesundheitseinrichtungen in Deutschland. 20 Plätze.",
    startDate: start, endDate: end,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Borivon, Konferenzräume", address: { "@type": "PostalAddress", addressLocality: "Casablanca", addressCountry: "MA" } },
    image: ["https://www.borivon.com/pflege/assets/og-workshop.jpg"],
    organizer: { "@type": "Organization", name: "Borivon", url: "https://www.borivon.com/" },
    performer: { "@type": "Person", name: "Youness Taoufiq" },
    inLanguage: "de", url: "https://www.borivon.com/workshop",
  }));
  if (!events.length) { problems++; console.error("NO open workshop dates found for the Event data"); }
  s = s.replace("</head>", `<script type="application/ld+json">${JSON.stringify(events)}</script>\n</head>`);
  pages.WORKSHOP_HTML = bv(s);
}

// the consent + tracking script is cached for a day: every page asks for it by content hash
const TJS = `/pflege/assets/t.js?v=${crypto.createHash("sha1").update(fs.readFileSync(path.join(OUT, "pflege", "assets", "t.js"))).digest("hex").slice(0, 8)}`;
for (const k of Object.keys(pages)) pages[k] = pages[k].split('/pflege/assets/t.js"').join(`${TJS}"`);

// ── free tools (founder 2026-11-10: expose the problem, show the lost potential; same model as the Rechner) ──
for (const [src, key, title, desc, path_] of [
  ["warten.html", "WARTEN_HTML", "Was kostet Sie jede Woche Warten? · Borivon", "Werkzeug: Was leere Stellen Ihre Einrichtung jede Woche kosten, und was es kostet, später zu starten. Mit Ihren eigenen Zahlen.", "https://www.borivon.com/fahrplan/warten"],
  ["kosten.html", "KOSTEN_HTML", "Was kostet Sie das? · Borivon", "Werkzeug für jede Einrichtung: Was leere Stellen, Kündigungen und jeder Monat Warten Sie kosten. Live, mit Ihren eigenen Werten.", "https://www.borivon.com/fahrplan/kosten"],
  ["bleibe-check.html", "BLEIBE_HTML", "Der Bleibe-Check · Borivon", "Werkzeug: Acht Fragen zu den ersten 90 Tagen. Sehen Sie, wo Ihnen neue Pflegekräfte in der Probezeit verloren gehen.", "https://www.borivon.com/fahrplan/bleibe-check"],
]) {
  let s = fs.readFileSync(path.join(SRC, src), "utf8");
  const i = s.indexOf("<!--HEAD-->");
  if (i < 0) { problems++; console.error("NOT FOUND: <!--HEAD--> in " + src); continue; }
  s = s.slice(0, i) + head(title, desc, path_, "https://www.borivon.com/pflege/assets/og-fahrplan-2.png") + s.slice(i + "<!--HEAD-->".length);
  pages[key] = bv(s);
}

// sanity: nothing may still reach outside servers
for (const [name, s] of Object.entries(pages)) {
  const f = name;
  const ext = s.match(/(?:src|href)="https?:\/\/(?!www\.borivon\.com)[^"]+"/g) || [];
  const scripts = s.match(/<script src="https?:[^"]+"/g) || [];
  if (ext.length || scripts.length) { problems++; console.error("EXTERNAL in", path.basename(f), [...ext, ...scripts].slice(0, 5)); }
  const rx = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = rx.exec(s))) { try { new Function(m[1]); } catch (e) { problems++; console.error("SCRIPT ERROR in", path.basename(f), e.message); } }
  console.log(name, Math.round(s.length / 1024) + " KB");
}
if (problems) { console.error(problems + " problem(s)"); process.exit(1); }

// Write the two static pages. Old locations must stay gone: /pflege would be a
// second address for the same page.
fs.writeFileSync(path.join(OUT, "index.html"), pages.HOME_HTML);
fs.writeFileSync(path.join(OUT, "plattform.html"), pages.PLATTFORM_HTML);
fs.writeFileSync(path.join(OUT, "fahrplan.html"), pages.FAHRPLAN_HTML);
fs.writeFileSync(path.join(OUT, "workshop.html"), pages.WORKSHOP_HTML);
fs.mkdirSync(path.join(OUT, "fahrplan"), { recursive: true });
fs.writeFileSync(path.join(OUT, "fahrplan", "rechner.html"), pages.RECHNER_HTML);
fs.writeFileSync(path.join(OUT, "fahrplan", "warten.html"), pages.WARTEN_HTML);
fs.writeFileSync(path.join(OUT, "fahrplan", "bleibe-check.html"), pages.BLEIBE_HTML);
fs.writeFileSync(path.join(OUT, "fahrplan", "kosten.html"), pages.KOSTEN_HTML);
for (const old of [path.join(OUT, "pflege.html"), path.join(OUT, "pflege", "plattform.html")]) fs.rmSync(old, { force: true });
console.log("public/index.html, public/plattform.html, public/fahrplan.html");
console.log("ok" + (withVoices ? " (with testimonials)" : ""));
