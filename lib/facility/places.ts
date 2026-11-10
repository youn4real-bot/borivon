/**
 * "Where does she go?" — the nearest Bürgerbüro, bank, Krankenkasse, Finanzamt, Ausländerbehörde and
 * family doctor for a German postcode, found automatically (founder 2026-11-10: "she lands in this
 * city in Bayern and the system detects the closest place").
 *
 * The places live in our own D1 table fx_places, loaded from OpenStreetMap by
 * scripts/fx-places-pull.mjs + fx-places-pack.mjs (the public Overpass server is far too slow to ask
 * live). At runtime only the POSTCODE (+ town) is looked up at OSM's Nominatim, once, then cached;
 * never a name or a street. Data © OpenStreetMap contributors (ODbL); the pages show the attribution.
 */
import { fxDb, nowIso } from "./db";
import type { PlaceKind } from "./steps";
import type { D1Row } from "@/lib/d1/client";

export type Place = {
  kind: PlaceKind; name: string; lat: number; lon: number; dist: number;
  address: string; hours?: string; website?: string;
};
export type Geo = { lat: number; lon: number; label: string; county: string; town: string };
export type PlacesResult = { center: { lat: number; lon: number; label: string }; places: Place[]; at: string };

const UA = "Borivon/1.0 (+https://borivon.com; contact@borivon.com)";
const GEO_DAYS = 180;

/** Search radii in km, widened until something is found. */
const RADII: Record<PlaceKind, number[]> = {
  bank: [2, 6, 20], arzt: [2, 6, 20], anmeldung: [6, 15, 40], kasse: [8, 25, 60],
  finanzamt: [15, 40, 90], auslaender: [20, 50, 110],
};

/** Distance in metres (haversine). */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The best row for one kind: distance × the row's weight (set when packed: e.g. a "Sparkasse" or a
 * "Bürgerbüro" beats a plain match nearby), and for the Ausländerbehörde a bonus when its name
 * carries the visitor's Landkreis or town (the responsible one, not just the nearest).
 */
export function nearest(rows: D1Row[], geo: Geo): Place | null {
  const county = geo.county.replace(/^(Landkreis|Kreis)\s+/i, "").trim();
  const countyRe = county ? new RegExp(escapeRe(county), "i") : null;
  const townRe = geo.town ? new RegExp(`\\b${escapeRe(geo.town)}\\b`, "i") : null;
  let best: { score: number; p: Place } | null = null;
  for (const r of rows) {
    const lat = Number(r.lat), lon = Number(r.lon), name = String(r.name ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) continue;
    const kind = String(r.kind) as PlaceKind;
    let w = Number(r.w) || 1;
    if (kind === "auslaender") {
      const lra = /^landratsamt|^kreisverwaltung/i.test(name);
      if (lra) {
        // a Landratsamt serves its Landkreis; a kreisfreie Stadt (no county from the geocoder) has its own office
        if (countyRe && countyRe.test(name)) w *= 0.45;
        else if (!county) w *= 2;
      } else if (townRe && townRe.test(name)) w *= 0.45;
    } else if (kind === "finanzamt") {
      if ((countyRe && countyRe.test(name)) || (townRe && townRe.test(name))) w *= 0.45;
    }
    const dist = distance(geo, { lat, lon });
    const score = dist * w;
    if (!best || score < best.score) {
      best = {
        score,
        p: {
          kind, name, lat, lon, dist: Math.round(dist), address: String(r.address ?? ""),
          ...(r.hours ? { hours: String(r.hours) } : {}),
          ...(r.website ? { website: String(r.website) } : {}),
        },
      };
    }
  }
  return best?.p ?? null;
}

type Fetch = typeof fetch;

/** Postcode → point (+ Landkreis, town), via Nominatim, cached for half a year. */
export async function geocode(plz: string, city: string, f: Fetch = fetch): Promise<Geo | null> {
  const key = `geo:v1:${plz}:${city.toLowerCase()}`;
  const db = await fxDb();
  if (db) {
    const { results } = await db.run(`SELECT json, at FROM fx_geo WHERE key = ?`, [key]);
    const r = results[0];
    if (r && Date.now() - Date.parse(String(r.at)) < GEO_DAYS * 86400e3) {
      try { return JSON.parse(String(r.json)) as Geo; } catch { /* ask again */ }
    }
  }
  const ask = async (withCity: boolean) => {
    const p = new URLSearchParams({ postalcode: plz, country: "de", format: "jsonv2", addressdetails: "1", limit: "1" });
    if (withCity && city) p.set("city", city);
    const res = await f(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { "User-Agent": UA, "Accept-Language": "de" } });
    return res.ok ? ((await res.json()) as { lat?: string; lon?: string; address?: Record<string, string> }[]) : [];
  };
  let list = await ask(true).catch(() => []);
  if (!list.length && city) list = await ask(false).catch(() => []); // a misspelt town must not block the postcode
  const g = list[0];
  if (!g?.lat || !g?.lon) return null;
  const a = g.address ?? {};
  const town = a.city || a.town || a.village || a.municipality || city || "";
  const geo: Geo = { lat: Number(g.lat), lon: Number(g.lon), label: [plz, town].filter(Boolean).join(" "), county: a.county || "", town };
  if (db) await db.run(`INSERT OR REPLACE INTO fx_geo (key, json, at) VALUES (?, ?, ?)`, [key, JSON.stringify(geo), nowIso()]).catch(() => {});
  return geo;
}

/** The nearest place of each kind around a point, from our own table. */
export async function placesAround(geo: Geo): Promise<Place[]> {
  const db = await fxDb();
  if (!db) return [];
  // the six kinds at once; within a kind, the circle widens until something is found
  const found = await Promise.all((Object.keys(RADII) as PlaceKind[]).map(async (kind) => {
    for (const km of RADII[kind]) {
      const dLat = km / 111, dLon = km / (111 * Math.cos((geo.lat * Math.PI) / 180));
      const { results } = await db.run(
        `SELECT kind, name, lat, lon, address, hours, website, w FROM fx_places WHERE kind = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 400`,
        [kind, geo.lat - dLat, geo.lat + dLat, geo.lon - dLon, geo.lon + dLon],
      );
      const p = nearest(results, geo);
      if (p) return p;
    }
    return null;
  }));
  return found.filter((p): p is Place => !!p);
}

/** Everything a page needs for one postcode. null = the postcode could not be placed. */
export async function placesFor(plz: string, city: string, f: Fetch = fetch): Promise<PlacesResult | null> {
  // the finished answer per postcode, kept 7 days (fx-places-pack.mjs clears these on every reload)
  const key = `places:v1:${plz}:${city.toLowerCase()}`;
  const db = await fxDb();
  if (db) {
    const r = (await db.run(`SELECT json, at FROM fx_geo WHERE key = ?`, [key])).results[0];
    if (r && Date.now() - Date.parse(String(r.at)) < 7 * 86400e3) {
      try { return JSON.parse(String(r.json)) as PlacesResult; } catch { /* compute again */ }
    }
  }
  const geo = await geocode(plz, city, f).catch(() => null);
  if (!geo) return null;
  const out: PlacesResult = { center: { lat: geo.lat, lon: geo.lon, label: geo.label }, places: await placesAround(geo), at: nowIso() };
  if (db) await db.run(`INSERT OR REPLACE INTO fx_geo (key, json, at) VALUES (?, ?, ?)`, [key, JSON.stringify(out), out.at]).catch(() => {});
  return out;
}
