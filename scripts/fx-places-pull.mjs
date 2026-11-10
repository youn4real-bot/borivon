// Pull the arrival-plan places for all of Germany from OpenStreetMap (Overpass), once.
// Output: <outDir>/<category>-<state>.json (raw Overpass JSON). Then run fx-places-pack.mjs.
//
// usage: node scripts/fx-places-pull.mjs <outDir> [category ...]
// Splits by Bundesland so each query stays small; retries a busy server; skips files already there.
// Data © OpenStreetMap contributors, ODbL. Be kind to the public server: one query at a time.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const UA = "Borivon/1.0 (+https://borivon.com; contact@borivon.com)";
const EPS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const ALL_STATES = ["DE-BY", "DE-BW", "DE-BE", "DE-BB", "DE-HB", "DE-HH", "DE-HE", "DE-MV", "DE-NI", "DE-NW", "DE-RP", "DE-SL", "DE-SN", "DE-ST", "DE-SH", "DE-TH"];
const STATES = process.env.STATES ? process.env.STATES.split(",") : ALL_STATES; // e.g. STATES=DE-BY

const Q = {
  gov: `nwr(area.a)["office"="government"]["name"~"Bürgerbüro|Bürgeramt|Bürgerservice|Bürgerzentrum|Bürgerdienste|Einwohner|Ausländer|Landratsamt|Kreisverwaltung|Kreisverwaltungsreferat|Finanzamt|Migration|Einbürgerung|Bürgerservicezentrum",i];
nwr(area.a)["amenity"="townhall"];
nwr(area.a)["building"]["name"~"^Finanzamt|^Landratsamt|Ausländerbehörde",i];`,
  bank: `nwr(area.a)["amenity"="bank"];`,
  kasse: `nwr(area.a)["office"="insurance"]["name"~"AOK|Techniker|Barmer|DAK|IKK|BKK|KKH|hkk|HEK|Knappschaft",i];`,
  arzt: `nwr(area.a)["amenity"="doctors"]["healthcare:speciality"~"general",i];
nwr(area.a)["amenity"="doctors"]["name"~"Allgemeinmedizin|Hausarzt|Allgemeinarzt|Hausärzt",i];`,
};

const [outDir, ...cats] = process.argv.slice(2);
if (!outDir) { console.error("usage: node scripts/fx-places-pull.mjs <outDir> [gov bank kasse arzt]"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const cat of cats.length ? cats : Object.keys(Q)) {
  for (const st of STATES) {
    const file = join(outDir, `${cat}-${st}.json`);
    if (existsSync(file)) { console.log("have", file); continue; }
    const q = `[out:json][timeout:600];area["ISO3166-2"="${st}"]->.a;(${Q[cat]});out center tags;`;
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt++) {
      const ep = EPS[attempt % EPS.length];
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 660_000);
        const res = await fetch(ep, { method: "POST", signal: ctl.signal, headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
        const txt = await res.text();
        clearTimeout(timer);
        if (!res.ok || !txt.startsWith("{")) throw new Error(`HTTP ${res.status} ${txt.slice(0, 80)}`);
        const j = JSON.parse(txt);
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 120));
        writeFileSync(file, txt);
        console.log("ok", cat, st, j.elements.length, "elements", Math.round((Date.now() - t0) / 1000) + "s");
        done = true;
      } catch (e) {
        console.log("retry", cat, st, ep, String(e?.message ?? e).slice(0, 120), Math.round((Date.now() - t0) / 1000) + "s");
        await sleep(15_000 * (attempt + 1));
      }
    }
    if (!done) console.log("FAILED", cat, st);
    await sleep(3000);
  }
}
console.log("pull done");
