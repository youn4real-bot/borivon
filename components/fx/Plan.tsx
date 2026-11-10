"use client";

import { useEffect, useMemo, useState } from "react";
import { STEPS, dueDate, type Lang, type PlaceKind, type StepId } from "@/lib/facility/steps";
import type { Place, PlacesResult } from "@/lib/facility/places";
import { FxMap } from "./FxMap";
import { fxT, fill } from "./i18n";

const LOC: Record<Lang, string> = { de: "de-DE", en: "en-GB", fr: "fr-FR" };
export const fmtDate = (iso: string, lang: Lang, long = false) =>
  iso ? new Date(iso + "T12:00:00Z").toLocaleDateString(LOC[lang], long ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }) : "";
const km = (m: number, lang: Lang) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toLocaleString(LOC[lang], { maximumFractionDigits: m < 9950 ? 1 : 0 })} km`);
const routeUrl = (p: Place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address ? `${p.name}, ${p.address}` : `${p.lat},${p.lon}`)}`;

const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>;

/**
 * The arrival plan: the steps in order (tick = done, synced), each with its nearest place, and the
 * map beside it. Used by the facility (/einrichtung) and by the nurse (/ankunft/<token>).
 */
export function Plan({ lang, arrival, steps, placesUrl, onToggle, voice = "facility" }: {
  lang: Lang;
  arrival: string;
  steps: Record<string, string>;
  placesUrl: string;
  onToggle: (id: StepId, done: boolean) => void;
  voice?: "facility" | "nurse";
}) {
  const t = fxT(lang);
  const [data, setData] = useState<PlacesResult | null>(null);
  const [state, setState] = useState<"load" | "ok" | "fail">("load");
  const [hl, setHl] = useState<PlaceKind | null>(null);

  useEffect(() => {
    let off = false;
    setState("load");
    fetch(placesUrl, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: PlacesResult) => { if (!off) { setData(j); setState("ok"); } })
      .catch(() => { if (!off) setState("fail"); });
    return () => { off = true; };
  }, [placesUrl]);

  const byKind = useMemo(() => new Map((data?.places ?? []).map((p) => [p.kind, p])), [data]);
  const numberOf = (k: PlaceKind) => STEPS.findIndex((s) => s.place === k) + 1;
  const today = new Date().toISOString().slice(0, 10);

  const pick = (k: PlaceKind) => {
    setHl(k);
    document.getElementById(`fx-step-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="fx-plan">
      <ol className="fx-steps">
        {STEPS.map((s, i) => {
          const done = !!steps[s.id];
          const due = dueDate(arrival, s);
          const place = s.place ? byKind.get(s.place) : undefined;
          return (
            <li key={s.id} id={s.place ? `fx-step-${s.place}` : undefined} className={`fx-step${done ? " done" : ""}`}
              onMouseEnter={() => s.place && setHl(s.place)} onMouseLeave={() => setHl(null)}>
              <button type="button" className="fx-tick" aria-pressed={done} aria-label={s.title[lang]} onClick={() => onToggle(s.id, !done)}>
                {done ? <Check /> : i + 1}
              </button>
              <div>
                <h3>
                  {s.title[lang]}
                  {due && !done && <span className={`due${due < today ? " late" : ""}`}>{fill(t.until, { d: fmtDate(due, lang) })}</span>}
                </h3>
                <p>{s.what[lang]}</p>
                {s.bring && <p className="bring"><b>{t.bring}:</b> {s.bring[lang]}</p>}
                {s.place && state === "ok" && (place ? (
                  <div className={`fx-place${hl === s.place ? " hl" : ""}`}>
                    <span className="pn">{place.name}</span>
                    <span className="pd">{fill(t.away, { d: km(place.dist, lang) })}</span>
                    <span className="pa">{place.address || " "}</span>
                    <span className="pr"><a href={routeUrl(place)} target="_blank" rel="noopener noreferrer">{t.route}</a></span>
                  </div>
                ) : <div className="fx-place none">{t.noPlace}</div>)}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="fx-mapwrap">
        {state === "ok" && data ? (
          <>
            <FxMap center={data.center} places={data.places} numberOf={numberOf} highlight={hl} onPick={pick} homeLabel={`${t.home}: ${data.center.label}`} />
            <ul className="fx-maplegend">
              {STEPS.filter((s) => s.place && byKind.has(s.place)).map((s) => (
                <li key={s.id}><b>{numberOf(s.place!)}</b>{s.title[lang]}</li>
              ))}
            </ul>
            <p className="fx-small" style={{ margin: "10px 0 0" }}>{t.checkNote}</p>
          </>
        ) : (
          <div className="fx-map" style={{ display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
            <span className="fx-small">{state === "load" ? t.placesLoading : t.placesFail}</span>
          </div>
        )}
        {voice === "nurse" && <p className="fx-small" style={{ margin: "14px 0 0" }}>{t.tapDone}</p>}
      </div>
    </div>
  );
}
