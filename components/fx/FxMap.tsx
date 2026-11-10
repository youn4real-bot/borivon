"use client";

import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/facility/places";
import type { PlaceKind } from "@/lib/facility/steps";

/**
 * A quiet map: OpenStreetMap tiles through our own server (/api/einrichtung/tile, no third party in
 * the browser), greyed to the paper tone, the home as a gold point, each place as a numbered pin.
 * Fits all points; no panning (it is a picture of "where", the Route links do the navigating).
 */
const TILE = 256;
const px = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const py = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

export function FxMap({ center, places, numberOf, highlight, onPick, homeLabel }: {
  center: { lat: number; lon: number };
  places: Place[];
  numberOf: (k: PlaceKind) => number;
  highlight?: PlaceKind | null;
  onPick?: (k: PlaceKind) => void;
  homeLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  let view: { z: number; ox: number; oy: number } | null = null;
  if (size && size.w > 0) {
    const pts = [center, ...places];
    const pad = 46;
    for (let z = 16; z >= 6; z--) {
      const xs = pts.map((p) => px(p.lon, z)), ys = pts.map((p) => py(p.lat, z));
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      if (w <= size.w - 2 * pad && h <= size.h - 2 * pad) {
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        view = { z, ox: cx - size.w / 2, oy: cy - size.h / 2 };
        break;
      }
    }
    if (!view) { const z = 6; view = { z, ox: px(center.lon, z) - size.w / 2, oy: py(center.lat, z) - size.h / 2 }; }
  }

  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (view && size) {
    const n = 2 ** view.z;
    const x0 = Math.floor(view.ox / TILE), x1 = Math.floor((view.ox + size.w) / TILE);
    const y0 = Math.floor(view.oy / TILE), y1 = Math.floor((view.oy + size.h) / TILE);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue;
      const wx = ((x % n) + n) % n;
      tiles.push({ key: `${view.z}/${x}/${y}`, src: `/api/einrichtung/tile/${view.z}/${wx}/${y}`, left: x * TILE - view.ox, top: y * TILE - view.oy });
    }
  }
  const at = (lat: number, lon: number) => view ? { left: px(lon, view.z) - view.ox, top: py(lat, view.z) - view.oy } : { left: -999, top: -999 };

  return (
    <div className="fx-map" ref={box} role="img" aria-label={homeLabel}>
      <div className="tiles" aria-hidden="true">
        {tiles.map((t) => <img key={t.key} src={t.src} alt="" style={{ left: t.left, top: t.top }} decoding="async" />)}
      </div>
      {view && <span className="fx-pin home" style={at(center.lat, center.lon)} title={homeLabel} />}
      {view && places.map((p) => (
        <button
          key={p.kind}
          type="button"
          className={`fx-pin${highlight === p.kind ? " hl" : ""}`}
          style={at(p.lat, p.lon)}
          title={p.name}
          aria-label={`${numberOf(p.kind)}: ${p.name}`}
          onClick={() => onPick?.(p.kind)}
        >
          {numberOf(p.kind)}
        </button>
      ))}
      <span className="fx-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></span>
    </div>
  );
}
