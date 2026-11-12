// Portal pages straight from the edge (founder 2026-11-12: "the loading page is really slow").
//
// Every /portal page is prerendered (○ Static in `next build`) — its HTML is the same for everyone, the
// data comes later from /api. Yet each visit still went THROUGH the worker, and a cold worker isolate
// costs 1-3 s (measured: /portal/dashboard 3.3 s cold, 0.2 s warm). Copying the prerendered HTML into the
// Workers static assets lets Cloudflare answer from the edge with no worker at all, so the page (and its
// logo loader) appears at once; only the /api calls still wake the worker.
//
// Run AFTER `opennextjs-cloudflare build`, BEFORE upload/deploy (scratchpad ship.sh / package.json cf:build).
// The next.config.ts security headers (CSP, frame, referrer, permissions …) never reach static assets, so
// they are copied from .next/routes-manifest.json into .open-next/assets/_headers for /portal and /portal/*.
// HTML must never be cached long (a new deploy = new chunk names): max-age=0, must-revalidate.
// Client-side RSC navigations to these paths now get HTML; Next then does a full page load — still fast.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = path.join(root, ".next", "server", "app");
const out = path.join(root, ".open-next", "assets");
if (!fs.existsSync(out) || !fs.existsSync(app)) {
  console.error("edge-shells: run after `opennextjs-cloudflare build` (no .open-next/assets or .next/server/app)");
  process.exit(1);
}

const pages = [];
const walk = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else if (e.name.endsWith(".html")) pages.push(r);
  }
};
if (fs.existsSync(path.join(app, "portal.html"))) pages.push("/portal.html");
if (fs.existsSync(path.join(app, "portal"))) walk(path.join(app, "portal"), "/portal");
for (const r of pages) {
  const dst = path.join(out, r);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(app, r), dst);
}

const rm = JSON.parse(fs.readFileSync(path.join(root, ".next", "routes-manifest.json"), "utf8"));
const rule = (rm.headers || []).find((h) => h.source === "/:path*");
if (!rule) { console.error("edge-shells: no '/:path*' header rule in routes-manifest — refusing to ship pages without their CSP"); process.exit(1); }
// "/*" in public/_headers already sets these two for every asset
const skip = /^(strict-transport-security|x-content-type-options)$/i;
const lines = rule.headers.filter((h) => !skip.test(h.key)).map((h) => `  ${h.key}: ${h.value}`);
if (!lines.some((l) => /content-security-policy/i.test(l))) { console.error("edge-shells: CSP missing — refusing"); process.exit(1); }
const block = ["", "# Portal pages served from the edge (scripts/edge-shells.mjs): next.config security headers, always revalidate."]
  .concat(["/portal", "/portal/*"].flatMap((p) => [p, ...lines, "  Cache-Control: public, max-age=0, must-revalidate"]))
  .join("\n") + "\n";
fs.appendFileSync(path.join(out, "_headers"), block);
console.log(`edge-shells: ${pages.length} portal pages → static assets (${pages.slice(0, 4).join(", ")}…)`);
