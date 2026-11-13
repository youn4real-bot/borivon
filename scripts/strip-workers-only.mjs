// Cloudflare build only (open-next.config.ts buildCommand): after `next build`, before OpenNext bundles the
// worker, cut packages that can never run on Workers out of the server output (founder 2026-11-12 "faster
// data" — every byte of the worker is parsed on each cold isolate).
//
// @react-pdf/renderer: Next keeps it as an external `import("@react-pdf/renderer")` (no webpack alias can
// reach an external), and OpenNext then bundles the whole package (+ pdfkit, fontkit, brotli, yoga, hyphen,
// linebreak …) into the worker. Every server use sits behind an ON_WORKERS=false branch (Workers render with
// pdf-lib, lib/pdflib/*), so on Workers that import never runs. It becomes a rejected promise: if a future
// change ever reached it on Workers, it fails loudly instead of rendering nothing.
import fs from "node:fs";
import path from "node:path";

// OpenNext bundles from Next's standalone copy (.next/standalone/.next/server), so both copies are cut
const roots = [path.join(process.cwd(), ".next", "server"), path.join(process.cwd(), ".next", "standalone", ".next", "server")].filter((d) => fs.existsSync(d));
const NEEDLES = ['import("@react-pdf/renderer")', "import('@react-pdf/renderer')"];
const STUB = 'Promise.reject(new Error("@react-pdf/renderer is not in the Cloudflare build (use lib/pdflib)"))';
let files = 0, hits = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith(".js")) continue;
    let s = fs.readFileSync(p, "utf8");
    let n = 0;
    for (const needle of NEEDLES) { const parts = s.split(needle); n += parts.length - 1; s = parts.join(STUB); }
    if (n) { fs.writeFileSync(p, s); files++; hits += n; }
  }
};
for (const r of roots) walk(r);
const left = (() => { let c = 0; const w = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (e.name.endsWith(".js") && /(require|import)\(["']@react-pdf\/renderer["']\)/.test(fs.readFileSync(p, "utf8"))) c++; } }; roots.forEach(w); return c; })();
if (left) { console.error(`strip-workers-only: ${left} file(s) still load "@react-pdf/renderer" — refusing`); process.exit(1); }
console.log(`strip-workers-only: @react-pdf/renderer cut from ${files} server file(s) (${hits} imports)`);

// 2) The static portal pages (○ in `next build`) are served straight from the edge (scripts/edge-shells.mjs
// copies their prerendered HTML into the assets), so the worker never renders them. Their page modules
// were still bundled into the worker and parsed on every cold isolate. Dropping them from the standalone
// app-paths-manifest keeps OpenNext from bundling them (its requirePage map is built from that manifest).
// Only routes that are BOTH under /portal AND prerendered — dynamic portal pages stay in the worker.
const sa = path.join(process.cwd(), ".next", "standalone", ".next", "server", "app-paths-manifest.json");
const pmFile = path.join(process.cwd(), ".next", "prerender-manifest.json");
if (fs.existsSync(sa) && fs.existsSync(pmFile)) {
  const pm = JSON.parse(fs.readFileSync(pmFile, "utf8"));
  const staticPortal = new Set(Object.keys(pm.routes || {}).filter((r) => r === "/portal" || r.startsWith("/portal/")));
  const app = path.join(process.cwd(), ".next", "server", "app");
  const m = JSON.parse(fs.readFileSync(sa, "utf8"));
  const dropped = [];
  for (const k of Object.keys(m)) {
    if (!k.endsWith("/page")) continue;
    const route = k.slice(0, -"/page".length) || "/";
    // the edge must really have this page's HTML before the worker lets go of it
    if (staticPortal.has(route) && fs.existsSync(path.join(app, `${route.slice(1)}.html`))) { delete m[k]; dropped.push(route); }
  }
  fs.writeFileSync(sa, JSON.stringify(m));
  console.log(`strip-workers-only: ${dropped.length} static portal pages left to the edge (${dropped.slice(0, 3).join(", ")}…)`);
}
