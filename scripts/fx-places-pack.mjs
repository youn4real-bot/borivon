// Turn the raw Overpass files (scripts/fx-places-pull.mjs) into SQL for the fx_places table.
// usage: node scripts/fx-places-pack.mjs <rawDir> <out.sql>
// then:  npx wrangler d1 execute <db> --remote --file=<out.sql>
//
// Each OSM object gets ONE kind and a weight (< 1 = preferred over plain distance). Pure, no network.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function classify(tags) {
  const name = (tags.name || "").trim();
  if (!name) return null;
  const amenity = tags.amenity || "", office = tags.office || "";
  const t = (re) => re.test(name);
  if (t(/ausländer|ausländerbehörde|einbürgerung|migration und integration|ausländerwesen/i)) return { kind: "auslaender", w: 0.5 };
  if (t(/kreisverwaltungsreferat/i)) return { kind: "auslaender", w: 0.6 };
  if (t(/^landratsamt|^kreisverwaltung/i)) {
    // a branch for something else (vets, health, youth, cars, roads …) is not where a residence permit is made
    if (t(/veterinär|gesundheitsamt|jugendamt|bauamt|zulassung|kfz|führerschein|abfall|wasser|forst|schul|vermessung|landwirtschaft|jobcenter|straßen|naturschutz|sozialamt|betreuung|archiv|museum/i)) return null;
    return { kind: "auslaender", w: 1 };
  }
  if (t(/^finanzamt/i)) return { kind: "finanzamt", w: t(/außenstelle|aussenstelle/i) ? 1.1 : 1 };
  if (t(/bürgerbüro|bürgeramt|bürgerservice|bürgerzentrum|bürgerdienste|einwohner/i)) {
    // an MP's constituency office is called "Bürgerbüro" too: not a registration office
    if (t(/mdb|mdl|abgeordnet|spd|cdu|csu|grüne|fdp|afd|linke|freie wähler/i)) return null;
    return { kind: "anmeldung", w: 0.7 };
  }
  if (amenity === "townhall") {
    if (tags.townhall_type === "city_council" || t(/ortsteil|ortschaft|bezirksausschuss/i)) return { kind: "anmeldung", w: 1.6 };
    return { kind: "anmeldung", w: 1 };
  }
  if (amenity === "bank") {
    if (tags.atm === "yes" && /^(atm|geldautomat)/i.test(name)) return null;
    const brand = `${tags.brand || ""} ${name}`;
    return { kind: "bank", w: /sparkasse|raiffeisen|volksbank|vr[ -]?bank|commerzbank|deutsche bank|postbank|hypovereinsbank|targobank|psd bank|sparda/i.test(brand) ? 0.8 : 1.2 };
  }
  if (office === "insurance") return { kind: "kasse", w: t(/\baok\b/i) ? 0.8 : 1 };
  if (amenity === "doctors") return { kind: "arzt", w: 1 };
  return null;
}

function address(tags) {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const town = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
  return [street, town].filter(Boolean).join(", ");
}

const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

if ((process.argv[1] ?? "").split("\\").join("/").endsWith("scripts/fx-places-pack.mjs")) {
  const [rawDir, outFile] = process.argv.slice(2);
  if (!rawDir || !outFile) { console.error("usage: node scripts/fx-places-pack.mjs <rawDir> <out.sql>"); process.exit(1); }
  const seen = new Set();
  const rows = [];
  const count = {};
  for (const f of readdirSync(rawDir).filter((x) => x.endsWith(".json")).sort()) {
    const j = JSON.parse(readFileSync(join(rawDir, f), "utf8"));
    for (const e of j.elements ?? []) {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
      if (lat == null || lon == null || !e.tags) continue;
      const c = classify(e.tags);
      if (!c) continue;
      // the same office as a point AND a building: keep one (same kind, same name, ~30 m)
      const k = `${c.kind}|${e.tags.name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      count[c.kind] = (count[c.kind] ?? 0) + 1;
      const hours = (e.tags.opening_hours || "").slice(0, 120);
      const web = /^https?:\/\//.test(e.tags.website || "") ? e.tags.website.slice(0, 200) : "";
      rows.push(`(${sq(c.kind)},${sq(e.tags.name.slice(0, 120))},${lat.toFixed(6)},${lon.toFixed(6)},${sq(address(e.tags).slice(0, 160))},${sq(hours)},${sq(web)},${c.w})`);
    }
  }
  const out = [
    `CREATE TABLE IF NOT EXISTS fx_places (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, address TEXT NOT NULL DEFAULT '', hours TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', w REAL NOT NULL DEFAULT 1);`,
    `CREATE INDEX IF NOT EXISTS fx_places_kind_lat ON fx_places(kind, lat);`,
    `DELETE FROM fx_places;`,
  ];
  for (let i = 0; i < rows.length; i += 200) out.push(`INSERT INTO fx_places (kind,name,lat,lon,address,hours,website,w) VALUES\n${rows.slice(i, i + 200).join(",\n")};`);
  writeFileSync(outFile, out.join("\n") + "\n");
  console.log("rows", rows.length, count, "→", outFile);
}
