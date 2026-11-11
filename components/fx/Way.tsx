"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import {
  buildWay, until, shortDate, stepName, WAY_ABROAD, WAY_GERMANY, WAY_NAME, WAY_WIN, ETA_NAME,
  type Way, type WayInput, type WayKey, type Tick, type Eta,
} from "@/lib/facility/way";
import { B2_STAGES, b2StageLabel, type B2Stage } from "@/lib/b2Journey";

/**
 * The nurse's whole way, as the approved premium mock (founder 2026-11-11: "less is more, visuals,
 * visuals, visuals, less text; a fifth grader gets it; WANN as a countdown, the date small").
 *   WayHero  – her own first screen (phone first): hello, a small win, one big icon, one next step, WANN.
 *   WayBoard – her page for the facility / Borivon: the line in two phases, the station she is at with
 *              who does what (tap to tick), the flat beside the visa, papers as tiles, Deutsch.
 * Numbers: lib/facility/way.ts from /api/portal/weg. Status colours stay LAW #4 (green / orange / red).
 */
type L = "de" | "en" | "fr";
type Data = { input: Omit<WayInput, "today">; today: string; photo: string | null };

const TABLE: Partial<Record<WayKey, string>> = { visa: "visa", trip: "move", arrive: "arrival", stay: "settle" };
const ANCHOR: Partial<Record<WayKey, string>> = { visa: "weg-visum", trip: "weg-anreise", arrive: "weg-wochen", stay: "weg-monate" };
const STORE: Partial<Record<WayKey, keyof WayInput["steps"]>> = { visa: "visa", trip: "move", arrive: "weeks", stay: "six" };
/** which step a countdown belongs to: the visa answer, the pick-up on the flight day, the first day */
const ETA_STEP: Partial<Record<Eta["kind"], string>> = { visa: "got", flight: "pickup", start: "day1" };

const W = {
  de: { hi: "Hallo", abroad: "Auf dem Weg", germany: "In Deutschland", of: "{a} von {b}", next: "Weiter", plan: "Plan & Termine", flat: "Wohnung", flatSub: "vor dem Visum", papers: "Unterlagen", wait: "{n} warten", open: "Öffnen", lang: "Deutsch", failed: "1× nicht bestanden", germanyIn: "Deutschland", nurse: "Pflegekraft", facility: "Einrichtung", both: "Beide", done: "erledigt", visaPapers: "Visa-Unterlagen", est: "geschätzt" },
  en: { hi: "Hello", abroad: "On the way", germany: "In Germany", of: "{a} of {b}", next: "Continue", plan: "Plan & dates", flat: "Flat", flatSub: "before the visa", papers: "Documents", wait: "{n} waiting", open: "Open", lang: "German", failed: "failed once", germanyIn: "Germany", nurse: "Nurse", facility: "Facility", both: "Both", done: "done", visaPapers: "Visa documents", est: "estimated" },
  fr: { hi: "Bonjour", abroad: "En route", germany: "En Allemagne", of: "{a} sur {b}", next: "Continuer", plan: "Plan & dates", flat: "Logement", flatSub: "avant le visa", papers: "Documents", wait: "{n} en attente", open: "Ouvrir", lang: "Allemand", failed: "échoué une fois", germanyIn: "Allemagne", nurse: "Infirmière", facility: "Établissement", both: "Les deux", done: "fait", visaPapers: "Documents visa", est: "estimé" },
};

/* ── icons: one line style, 24 grid ─────────────────────────────────────────── */
const PATH: Record<string, string> = {
  chk: "M5 12.5l4.5 4.5L19 7.5",
  lang: "M4 5h9M8.5 3v2M6 5c0 4 3 7 7 8M11 5c-1 4-4 7-7 8M13 21l4-9 4 9M14.5 18h5",
  papers: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8.5 13h7M8.5 17h5",
  recog: "M5 21h14M6 17h12v-2a2 2 0 0 0-2-2h-2l-1-6a2 2 0 1 0-2 0l-1 6H8a2 2 0 0 0-2 2z",
  visa: "M7 2.5h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.5 17h7",
  trip: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  arrive: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  stay: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z",
  home: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  bld: "M3 21h18M5 21V9l7-5 7 5v12M9.5 21v-5.5h5V21",
  arr: "M5 12h14M13 6l6 6-6 6",
  cal: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18",
};
export function WayIcon({ k, size = 20, stroke = 1.5 }: { k: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d={PATH[k] ?? PATH.papers} />
    </svg>
  );
}

const CSS = `
.bw{--bw-ok:#16a34a;color:var(--w)}
.bw .serif{font-family:var(--font-serif)}
.bw-road{display:flex;gap:clamp(14px,3vw,30px)}
.bw-grp{display:flex;flex-direction:column;gap:10px;min-width:0}
.bw-grp>small{font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--w3);white-space:nowrap}
.bw-line{display:flex;align-items:center;height:var(--bw-now)}
.bw-line s{flex:1;min-width:6px;height:2px;background:var(--border);text-decoration:none}
.bw-line s.f{background:var(--w)}
.bw-st{width:var(--bw-d);height:var(--bw-d);border-radius:50%;display:grid;place-items:center;flex:none;background:var(--card);border:1.5px solid var(--border);color:var(--w3)}
.bw-st.f{background:var(--w);border-color:var(--w);color:var(--bg)}
.bw-st.n{width:var(--bw-now);height:var(--bw-now);border:2px solid var(--gold);color:var(--gold);box-shadow:0 0 0 6px var(--gdim)}
.bw-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 22px}
.bw-tile{display:grid;place-items:center;border-radius:12px;background:var(--bg2,var(--bg));color:var(--gold)}
.bw-row{display:grid;grid-template-columns:28px 1fr 28px minmax(56px,auto);gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--border);font-size:15px;width:100%;background:none;border-left:0;border-right:0;border-bottom:0;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.bw-row:first-of-type{border-top:0}
.bw-row:disabled{cursor:default}
.bw-box{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--border);display:grid;place-items:center;color:var(--bg)}
.bw-row.d .bw-box{background:var(--w);border-color:var(--w)}
.bw-row.d .bw-nm{color:var(--w3)}
.bw-row:not(:disabled):hover .bw-box{border-color:var(--gold)}
.bw-who{width:28px;height:28px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:11px;font-weight:600}
.bw-cd{text-align:right;font-family:var(--font-serif);font-size:19px;white-space:nowrap}
.bw-cd.m{font-family:inherit;font-size:12px;color:var(--w3)}
.bw-doc{width:30px;height:36px;border-radius:6px;background:var(--bg2,var(--bg));display:grid;place-items:center;position:relative;color:var(--w3)}
.bw-doc i{position:absolute;right:-3px;top:-3px;width:9px;height:9px;border-radius:50%;border:2px solid var(--card)}
.bw-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 7px;border-radius:999px;background:rgba(22,163,74,.1);color:#15803d;font-size:13px;font-weight:500}
.bw-pill b{width:18px;height:18px;border-radius:50%;background:var(--bw-ok);display:grid;place-items:center;color:#fff}
.bw-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:50px;border:0;border-radius:12px;background:var(--w);color:var(--bg);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
.bw-link{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--w3);text-decoration:none;background:none;border:0;cursor:pointer;font-family:inherit;padding:0}
.bw-link:hover{color:var(--w)}
.bw-cols{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;margin-top:26px}
@media (max-width:760px){.bw-cols{grid-template-columns:1fr}}
@media (prefers-reduced-motion:no-preference){.bw-st.n{animation:bwPulse 2.4s ease-in-out infinite}}
@keyframes bwPulse{50%{box-shadow:0 0 0 9px var(--gdim)}}
`;

/* ── data ───────────────────────────────────────────────────────────────────── */
export function useWay(userId?: string) {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) return;
    const r = await fetch(`/api/portal/weg${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`, { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as Data | null) : null;
    if (j?.input) setD(j);
  }, [userId]);
  useEffect(() => { setD(null); void load(); }, [load]);
  const way = useMemo<Way | null>(() => (d ? buildWay({ ...d.input, today: d.today }) : null), [d]);

  // tick a step: shown at once, saved in the background, the truth reloaded after
  const toggle = useCallback(async (st: WayKey | "home", id: string, done: boolean) => {
    const table = st === "home" ? "move" : TABLE[st];
    const store = st === "home" ? "move" : STORE[st];
    if (!table || !store) return;
    setD((cur) => {
      if (!cur) return cur;
      const s = { ...cur.input.steps[store] };
      if (done) s[id] = new Date().toISOString(); else delete s[id];
      return { ...cur, input: { ...cur.input, steps: { ...cur.input.steps, [store]: s } } };
    });
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (tok) await fetch(`/api/portal/${table}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ ...(userId ? { userId } : {}), step: id, done }) }).catch(() => null);
    void load();
  }, [userId, load]);
  return { d, way, toggle };
}

const useL = (): L => { const { lang } = useLang(); return (["de", "en", "fr"].includes(lang) ? lang : "de") as L; };
const fmt = (s: string, a: number, b: number) => s.replace("{a}", String(a)).replace("{b}", String(b));
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("");

/* ── the line: two phases, icons, done = ink check, now = gold ring ─────────── */
export function WayLine({ way, compact = false }: { way: Way; compact?: boolean }) {
  const l = useL();
  const t = W[l];
  const keys = way.stations.map((s) => s.key);
  const grp = (label: string, ks: WayKey[]) => {
    const st = way.stations.filter((s) => ks.includes(s.key));
    if (!st.length) return null;
    return (
      <div className="bw-grp" style={{ flex: st.length }}>
        {!compact && <small>{label}</small>}
        <div className="bw-line">
          {st.map((s, i) => {
            const cls = s.done ? "f" : s.key === way.now ? "n" : "";
            const prevDone = i > 0 && st[i - 1].done;
            return (
              <span key={s.key} style={{ display: "contents" }}>
                {i > 0 && <s className={prevDone && (s.done || s.key === way.now) ? "f" : ""} />}
                <span className={`bw-st ${cls}`} title={`${WAY_NAME[s.key][l]} · ${fmt(t.of, s.p[0], s.p[1])}`}>
                  <WayIcon k={s.done ? "chk" : s.key} size={s.key === way.now ? (compact ? 15 : 22) : compact ? 12 : 17} stroke={s.done ? 2.4 : 1.6} />
                </span>
              </span>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="bw-road" style={{ ["--bw-d" as string]: compact ? "26px" : "clamp(30px,6vw,40px)", ["--bw-now" as string]: compact ? "34px" : "clamp(40px,8vw,52px)", gap: compact ? 10 : undefined } as React.CSSProperties}
      role="img" aria-label={keys.map((k) => WAY_NAME[k][l]).join(" → ")}>
      {grp(t.abroad, WAY_ABROAD)}
      {grp(t.germany, WAY_GERMANY)}
    </div>
  );
}

function Count({ eta, today, big = 19 }: { eta: Eta; today: string; big?: number }) {
  const l = useL();
  const u = until(today, eta.date, l);
  return (
    <span style={{ display: "block", textAlign: "right" }}>
      <span className="serif" style={{ display: "block", fontSize: big, lineHeight: 1 }}>{eta.est ? "~ " : ""}{u.word}</span>
      <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "var(--w3)" }}>{shortDate(eta.date, l)}</span>
    </span>
  );
}

/* ── her own first screen ───────────────────────────────────────────────────── */
export function WayHero({ name, onDocs }: { name: string; onDocs?: () => void }) {
  const l = useL();
  const t = W[l];
  const { d, way } = useWay();
  const first = (name || "").trim().split(/\s+/)[0] ?? "";
  const go = () => {
    if (!way) return;
    const a = ANCHOR[way.now];
    if (a) location.href = `/portal/ankunft#${a}`; else onDocs?.();
  };
  const cur = way?.stations.find((s) => s.key === way.now);
  const land = way && way.eta && way.eta.kind !== way.nowEta?.kind && (way.eta.kind === "flight" || way.eta.kind === "start") ? way.eta : null;
  return (
    <section className="bw" aria-label={t.hi} style={{ maxWidth: 460, margin: "0 auto 34px", textAlign: "center" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 34, fontWeight: 400, lineHeight: 1 }}>{t.hi}{first ? ` ${first}` : ""}.</h1>
        {d?.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={d.photo} alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
          : null}
      </div>
      {way && (
        <>
          {way.win && <div style={{ marginTop: 18 }}><span className="bw-pill"><b><WayIcon k="chk" size={11} stroke={2.6} /></b>{WAY_WIN[way.win][l]}</span></div>}
          <div style={{ width: 128, height: 128, margin: "30px auto 0", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--gdim)", color: "var(--gold)", boxShadow: "0 0 0 12px color-mix(in srgb, var(--gdim) 45%, transparent)" }}>
            <WayIcon k={way.now} size={54} stroke={1.3} />
          </div>
          <div className="serif" style={{ marginTop: 20, fontSize: 24 }}>{way.nowEta ? ETA_NAME[way.nowEta.kind][l] : way.next ? stepName(way.next, l) : WAY_NAME[way.now][l]}</div>
          {way.nowEta ? (
            <>
              <div className="serif" style={{ marginTop: 6, fontSize: 46, lineHeight: 1 }}>{way.nowEta.est ? "~ " : ""}{until(d!.today, way.nowEta.date, l).word}</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--w3)" }}>{shortDate(way.nowEta.date, l)}{way.nowEta.est ? ` · ${t.est}` : ""}</div>
            </>
          ) : cur ? (
            <div className="serif" style={{ marginTop: 8, fontSize: 30, lineHeight: 1, color: "var(--w2)" }}>{fmt(t.of, cur.p[0], cur.p[1])}</div>
          ) : null}
          <button type="button" className="bw-btn" style={{ marginTop: 24 }} onClick={go}>{t.next} <WayIcon k="arr" size={18} /></button>
          <div style={{ marginTop: 26, display: "flex", justifyContent: "center" }}><div style={{ width: "100%", maxWidth: 360 }}><WayLine way={way} compact /></div></div>
          {land && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 20, fontSize: 13, color: "var(--w3)" }}>
              <span style={{ color: "var(--gold)" }}><WayIcon k="trip" size={18} /></span>{ETA_NAME[land.kind][l]}
              <b className="serif" style={{ fontWeight: 400, fontSize: 20, color: "var(--w)" }}>{until(d!.today, land.date, l).word}</b>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── her page, for the facility and Borivon ─────────────────────────────────── */
function Who({ who, photo, name }: { who: Tick["who"]; photo: string | null; name: string }) {
  const l = useL();
  const t = W[l];
  const nurse = photo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="bw-who" src={photo} alt="" />
    : <span className="bw-who" style={{ background: "var(--gdim)", color: "var(--gold)" }}>{initials(name)}</span>;
  const fac = <span className="bw-who" style={{ background: "var(--w)", color: "var(--bg)" }}><WayIcon k="bld" size={14} /></span>;
  return (
    <span title={who === "nurse" ? name || t.nurse : who === "facility" ? t.facility : t.both} style={{ display: "inline-grid", justifyItems: "center" }}>
      {who === "nurse" ? nurse : who === "facility" ? fac : (
        <span style={{ position: "relative", width: 28, height: 28 }}>
          <span style={{ position: "absolute", left: -6, top: 0, transform: "scale(.8)" }}>{nurse}</span>
          <span style={{ position: "absolute", left: 6, top: 0, transform: "scale(.8)" }}>{fac}</span>
        </span>
      )}
    </span>
  );
}

function Ticks({ ticks, onTick, photo, name, firstEta, today }: { ticks: Tick[]; onTick: (id: string, done: boolean) => void; photo: string | null; name: string; firstEta: Eta | null; today: string }) {
  const l = useL();
  const t = W[l];
  const at = firstEta ? ETA_STEP[firstEta.kind] : undefined;
  return (
    <div>
      {ticks.map((x) => (
        <button key={x.id} type="button" className={`bw-row ${x.done ? "d" : ""}`} onClick={() => onTick(x.id, !x.done)} aria-pressed={x.done}>
          <span className="bw-box">{x.done && <WayIcon k="chk" size={13} stroke={2.4} />}</span>
          <span className="bw-nm">{stepName(x.id, l)}</span>
          <Who who={x.who} photo={photo} name={name} />
          {x.done ? <span className="bw-cd m">{t.done}</span>
            : x.id === at && firstEta ? (() => { const u = until(today, firstEta.date, l); return <span className="bw-cd">{firstEta.est ? "~ " : ""}{u.n ? `${u.n} ${u.unit}` : u.unit}</span>; })()
            : <span />}
        </button>
      ))}
    </div>
  );
}

export function WayBoard({ userId, name, onDocs }: { userId: string; name: string; onDocs?: () => void }) {
  const l = useL();
  const t = W[l];
  const { d, way, toggle } = useWay(userId);
  const [flatOpen, setFlatOpen] = useState(false);
  if (!d || !way) return null;
  const cur = way.stations.find((s) => s.key === way.now)!;
  const docs = d.input.docs;
  const b2 = d.input.b2;
  const plan = `/portal/admin/ankunft/${userId}?name=${encodeURIComponent(name)}`;
  const home = way.home;
  const homeDone = home.filter((h) => h.done).length;
  const showFlat = ["papers", "recog", "visa", "trip"].includes(way.now) || homeDone < home.length;
  const docP = docs ? (way.now === "recog" ? docs.bearbeitung : way.now === "visa" && docs.visum[1] > 0 ? docs.visum : docs.papers) : null;
  const b2pos = b2 ? (B2_STAGES.find((s) => s.key === b2.stage)?.position ?? 0) : 0;

  return (
    <section className="bw" aria-label={name}>
      <style>{CSS}</style>
      {/* the outcome first: when she starts */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        {way.win ? <span className="bw-pill"><b><WayIcon k="chk" size={11} stroke={2.6} /></b>{WAY_WIN[way.win][l]}</span> : <span />}
        {way.eta && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="bw-tile" style={{ width: 44, height: 44 }}><WayIcon k={way.eta.kind === "visa" ? "visa" : way.eta.kind === "probation" ? "stay" : "trip"} size={20} /></span>
            <div style={{ textAlign: "left" }}>
              <small style={{ display: "block", fontSize: 12, color: "var(--w3)" }}>{ETA_NAME[way.eta.kind][l]}{way.eta.est ? ` · ${t.est}` : ""}</small>
              <b className="serif" style={{ display: "block", fontWeight: 400, fontSize: 28, lineHeight: 1.05 }}>{until(d.today, way.eta.date, l).word}</b>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 22 }}><WayLine way={way} /></div>

      <div className="bw-cols">
        {/* the station she is at: who does what, tap to tick */}
        <div className="bw-card">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <span className="serif" style={{ fontSize: 24 }}>{WAY_NAME[way.now][l]}</span>
            <span style={{ fontSize: 12, color: "var(--w3)" }}>{fmt(t.of, cur.p[0], cur.p[1])}</span>
          </div>
          {way.now === "visa" && docs && docs.visum[1] > 0 && (
            <button type="button" className={`bw-row ${docs.visum[0] >= docs.visum[1] ? "d" : ""}`} onClick={onDocs}>
              <span className="bw-box">{docs.visum[0] >= docs.visum[1] && <WayIcon k="chk" size={13} stroke={2.4} />}</span>
              <span className="bw-nm">{t.visaPapers}</span>
              <span className="bw-who" style={{ color: "var(--w3)" }}><WayIcon k="papers" size={16} /></span>
              <span className="bw-cd m">{docs.visum[0]} / {docs.visum[1]}</span>
            </button>
          )}
          {way.ticks.length > 0
            ? <Ticks ticks={way.ticks} onTick={(id, done) => toggle(way.now, id, done)} photo={d.photo} name={name} firstEta={way.nowEta} today={d.today} />
            : docP && (
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "8px 0 14px" }}>
                  <span className="serif" style={{ fontSize: 44, lineHeight: 1 }}>{docP[0]}</span>
                  <span className="serif" style={{ fontSize: 22, color: "var(--w3)" }}>/ {docP[1]}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {Array.from({ length: Math.min(docP[1], 30) }, (_, i) => (
                    <span key={i} className="bw-doc"><WayIcon k="papers" size={14} /><i style={{ background: i < docP[0] ? "var(--bw-ok)" : "var(--border)" }} /></span>
                  ))}
                </div>
                {onDocs && <button type="button" className="bw-btn" style={{ marginTop: 18, height: 44, fontSize: 14 }} onClick={onDocs}>{t.open} <WayIcon k="arr" size={16} /></button>}
              </div>
            )}
          <div style={{ marginTop: 14, textAlign: "right" }}><a className="bw-link" href={plan}><WayIcon k="cal" size={15} />{t.plan}<WayIcon k="arr" size={14} /></a></div>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {/* the flat, beside the visa */}
          {showFlat && (
            <div className="bw-card">
              <button type="button" onClick={() => setFlatOpen((o) => !o)} aria-expanded={flatOpen} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span className="bw-tile" style={{ width: 46, height: 46 }}><WayIcon k="home" size={20} /></span>
                <span style={{ flex: 1 }}><span className="serif" style={{ display: "block", fontSize: 22 }}>{t.flat}</span><span style={{ fontSize: 12.5, color: "var(--w3)" }}>{t.flatSub}</span></span>
                <span className="serif" style={{ fontSize: 28 }}>{homeDone}<span style={{ fontSize: 16, color: "var(--w3)" }}> / {home.length}</span></span>
              </button>
              <span aria-hidden="true" style={{ display: "block", height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden", marginTop: 14 }}>
                <span style={{ display: "block", height: "100%", width: `${(homeDone / home.length) * 100}%`, background: homeDone === home.length ? "var(--bw-ok)" : "var(--gold)" }} />
              </span>
              {flatOpen && <div style={{ marginTop: 8 }}><Ticks ticks={home} onTick={(id, done) => toggle("home", id, done)} photo={d.photo} name={name} firstEta={null} today={d.today} /></div>}
            </div>
          )}

          {/* papers as tiles; the count that waits for you in orange */}
          {docs && (
            <button type="button" className="bw-card" onClick={onDocs} style={{ textAlign: "left", cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <span className="serif" style={{ fontSize: 22 }}>{t.papers}</span>
                <span style={{ fontSize: 12, color: "var(--w3)" }}>{docs.papers[0]} / {docs.papers[1]}</span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {Array.from({ length: Math.min(docs.papers[1], 24) }, (_, i) => (
                  <span key={i} className="bw-doc"><WayIcon k="papers" size={14} /><i style={{ background: i < docs.papers[0] ? "var(--bw-ok)" : "var(--border)" }} /></span>
                ))}
              </span>
              {(docs.pending ?? 0) > 0 && <span style={{ display: "inline-block", marginTop: 12, fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>{t.wait.replace("{n}", String(docs.pending))}</span>}
            </button>
          )}

          {/* Deutsch: the way to B2 */}
          {b2 && (
            <div className="bw-card">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="bw-tile" style={{ width: 46, height: 46 }}><WayIcon k="lang" size={20} /></span>
                <span style={{ flex: 1 }}><span className="serif" style={{ display: "block", fontSize: 22 }}>{t.lang} B2</span><span style={{ fontSize: 12.5, color: "var(--w3)" }}>{b2StageLabel(b2.stage as B2Stage, l)}</span></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 14 }} aria-hidden="true">
                {B2_STAGES.map((s, i) => (
                  <span key={s.key} style={{ display: "contents" }}>
                    {i > 0 && <span style={{ flex: 1, height: 2, background: i <= b2pos ? "var(--w)" : "var(--border)" }} />}
                    <span style={{ width: i === b2pos ? 14 : 10, height: i === b2pos ? 14 : 10, borderRadius: "50%", flex: "none",
                      background: i < b2pos || b2.stage === "passed" ? (b2.stage === "passed" ? "var(--bw-ok)" : "var(--w)") : "var(--card)",
                      border: `2px solid ${b2.stage === "passed" ? "var(--bw-ok)" : i < b2pos ? "var(--w)" : i === b2pos ? "var(--gold)" : "var(--border)"}` }} />
                  </span>
                ))}
              </div>
              {b2.failed && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12.5, color: "var(--danger, #dc2626)" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />{t.failed}</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** one row of the facility list: where she is, as dots; what comes next; WANN */
export type WayRow = { st: [WayKey, 0 | 1 | 2][]; now: WayKey; p: [number, number]; next: string | null; eta: Eta | null; today: string };
export function WayDots({ row }: { row: WayRow }) {
  return (
    <span style={{ display: "flex", alignItems: "center" }} aria-hidden="true">
      {row.st.map(([k, s], i) => (
        <span key={k} style={{ display: "contents" }}>
          {i > 0 && <span style={{ flex: 1, minWidth: 4, height: 1.5, background: s >= 1 && row.st[i - 1][1] === 2 ? "var(--w)" : "var(--border)", marginLeft: k === "arrive" ? 6 : 0 }} />}
          <span style={{ width: s === 1 ? 11 : 7, height: s === 1 ? 11 : 7, borderRadius: "50%", flex: "none",
            background: s === 2 ? "var(--w)" : "var(--card)", border: `${s === 1 ? 2 : 1.5}px solid ${s === 2 ? "var(--w)" : s === 1 ? "var(--gold)" : "var(--border)"}`,
            boxShadow: s === 1 ? "0 0 0 3px var(--gdim)" : undefined }} />
        </span>
      ))}
    </span>
  );
}
export function WayNext({ row }: { row: WayRow }) {
  const l = useL();
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span className="bw-tile" style={{ width: 34, height: 34, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: "var(--bg2, var(--bg))", color: "var(--gold)" }}><WayIcon k={row.now} size={16} /></span>
      <span style={{ fontSize: 13.5, color: "var(--w)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.next ? stepName(row.next, l) : WAY_NAME[row.now][l]}</span>
    </span>
  );
}
export function WayWhen({ row }: { row: WayRow }) {
  const l = useL();
  if (!row.eta) return <span style={{ display: "block", textAlign: "right", fontFamily: "var(--font-serif)", fontSize: 17, color: "var(--w3)" }}>{row.p[0]}<span style={{ fontSize: 13 }}> / {row.p[1]}</span></span>;
  const u = until(row.today, row.eta.date, l);
  return (
    <span style={{ display: "block", textAlign: "right", lineHeight: 1 }}>
      <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 24, color: row.eta.est ? "var(--w2)" : "var(--w)" }}>{row.eta.est ? "~" : ""}{u.n || u.unit}{u.n && <span style={{ fontSize: 13, color: "var(--w3)", marginLeft: 4 }}>{u.unit}</span>}</span>
      <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "var(--w3)", whiteSpace: "nowrap" }}>{ETA_NAME[row.eta.kind][l]}</span>
    </span>
  );
}
