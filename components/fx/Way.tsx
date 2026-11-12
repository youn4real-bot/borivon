"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import {
  buildWay, until, shortDate, stepName, WAY_ABROAD, WAY_GERMANY, WAY_NAME, WAY_WIN, ETA_NAME,
  type Way, type WayInput, type WayKey, type Tick, type Eta,
} from "@/lib/facility/way";
import type { LangInfo, Marks } from "@/lib/facility/track";
import { LangCard, ContractCard, KpCard, KeyPapers, DatePick } from "./WayMore";
import { TalkView, useTalk, talkDays } from "./Talk";
import { ProfileCard } from "./Profile";
import { StartView, useStart } from "./Start";
import { SalaryView } from "./Salary";

/**
 * The nurse's whole way, as the approved premium mock (founder 2026-11-11: "less is more, visuals,
 * visuals, visuals, less text; a fifth grader gets it; WANN as a countdown, the date small").
 *   WayHero  – her own first screen (phone first): hello, a small win, one big icon, one next step, WANN.
 *   WayBoard – her page for the facility / Borivon: the line in two phases, the station she is at with
 *              who does what (tap to tick), the flat beside the visa, papers as tiles, Deutsch.
 * Numbers: lib/facility/way.ts from /api/portal/weg. Status colours stay LAW #4 (green / orange / red).
 */
type L = "de" | "en" | "fr";
type Data = { input: Omit<WayInput, "today">; today: string; photo: string | null; admin?: boolean };

const TABLE: Partial<Record<WayKey, string>> = { visa: "visa", trip: "move", arrive: "arrival", stay: "settle" };
const ANCHOR: Partial<Record<WayKey, string>> = { visa: "weg-visum", trip: "weg-anreise", arrive: "weg-wochen", stay: "weg-monate" };
const STORE: Partial<Record<WayKey, keyof WayInput["steps"]>> = { visa: "visa", trip: "move", arrive: "weeks", stay: "six" };
/** which step a countdown belongs to: the visa answer, the pick-up on the flight day, the first day */
const ETA_STEP: Partial<Record<Eta["kind"], string>> = { visa: "got", flight: "pickup", start: "day1" };

const W = {
  de: { hi: "Hallo", abroad: "Auf dem Weg", germany: "In Deutschland", of: "{a} von {b}", next: "Weiter", plan: "Plan & Termine", flat: "Wohnung", flatSub: "vor dem Visum", papers: "Unterlagen", wait: "{n} warten", open: "Öffnen", lang: "Deutsch", failed: "1× nicht bestanden", germanyIn: "Deutschland", doneAll: "geschafft", nurse: "Pflegekraft", facility: "Einrichtung", both: "Beide", done: "erledigt", visaPapers: "Visa-Unterlagen", est: "geschätzt" },
  en: { hi: "Hello", abroad: "On the way", germany: "In Germany", of: "{a} of {b}", next: "Continue", plan: "Plan & dates", flat: "Flat", flatSub: "before the visa", papers: "Documents", wait: "{n} waiting", open: "Open", lang: "German", failed: "failed once", germanyIn: "Germany", doneAll: "done", nurse: "Nurse", facility: "Facility", both: "Both", done: "done", visaPapers: "Visa documents", est: "estimated" },
  fr: { hi: "Bonjour", abroad: "En route", germany: "En Allemagne", of: "{a} sur {b}", next: "Continuer", plan: "Plan & dates", flat: "Logement", flatSub: "avant le visa", papers: "Documents", wait: "{n} en attente", open: "Ouvrir", lang: "Allemand", failed: "échoué une fois", germanyIn: "Allemagne", doneAll: "réussi", nurse: "Infirmière", facility: "Établissement", both: "Les deux", done: "fait", visaPapers: "Documents visa", est: "estimé" },
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
  dn: "M6 9.5l6 6 6-6",
  cal: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18",
  contract: "M3 17c3-1 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2M3 21h18",
  kp: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  ear: "M6 8.5a6 6 0 1 1 12 0c0 6-6 6-6 10a3 3 0 0 1-6 0M9 9a3 3 0 0 1 6 0",
  pen: "M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  talk: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};
export function WayIcon({ k, size = 20, stroke = 1.5 }: { k: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d={PATH[k] ?? PATH.papers} />
    </svg>
  );
}

const CSS = `
.bw{--bw-ok:#16a34a;--bw-hair:color-mix(in srgb,var(--w) 15%,transparent);--bw-ease:cubic-bezier(.2,.7,.2,1);color:var(--w)}
.bw .serif{font-family:var(--font-serif)}
.bw button:focus-visible,.bw a:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:10px}
.bw-road{display:flex;gap:clamp(14px,3vw,30px)}
.bw-grp{display:flex;flex-direction:column;gap:10px;min-width:0}
.bw-grp>small{font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--w3);white-space:nowrap}
.bw-line{display:flex;align-items:center;height:var(--bw-now)}
.bw-line s{flex:1;min-width:6px;height:2px;background:var(--bw-hair);text-decoration:none}
.bw-line s.f{background:var(--w)}
.bw-st{width:var(--bw-d);height:var(--bw-d);box-sizing:border-box;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--card);border:1.5px solid var(--bw-hair);color:var(--w3)}
.bw-st.f{background:var(--w);border-color:var(--w);color:var(--bg)}
.bw-st.n{width:var(--bw-now);height:var(--bw-now);border:2px solid var(--gold);color:var(--gold);box-shadow:0 0 0 6px var(--gdim)}
.bw-card{display:block;width:100%;box-sizing:border-box;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px 24px;box-shadow:0 1px 2px rgba(0,0,0,.03),0 16px 36px -24px rgba(0,0,0,.18);transition:transform .3s var(--bw-ease),box-shadow .3s var(--bw-ease),border-color .3s var(--bw-ease)}
button.bw-card:hover{transform:translateY(-2px);border-color:var(--bw-hair);box-shadow:0 1px 2px rgba(0,0,0,.03),0 22px 40px -22px rgba(0,0,0,.24)}
button.bw-card:active{transform:translateY(0)}
.bw-tile{display:grid;place-items:center;border-radius:12px;background:color-mix(in srgb,var(--gold) 9%,var(--card));color:var(--gold);flex:none}
.bw-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto 44px;gap:14px;align-items:center;min-height:48px;padding:6px 0;border:0;border-top:1px solid var(--border);font-size:15px;line-height:1.3;width:100%;background:none;color:inherit;text-align:left;cursor:pointer;font-family:inherit}
.bw-rows>.bw-row:first-child{border-top:0}
.bw-row:disabled{cursor:default}
.bw-box{width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--w) 26%,transparent);display:grid;place-items:center;color:var(--bg);transition:background .25s var(--bw-ease),border-color .25s var(--bw-ease),transform .25s var(--bw-ease)}
.bw-row.d .bw-box{background:var(--w);border-color:var(--w)}
.bw-nm{transition:color .25s var(--bw-ease)}
.bw-row.d .bw-nm{color:var(--w3)}
.bw-row:not(:disabled):hover .bw-box{border-color:var(--gold);transform:scale(1.08)}
.bw-row:not(:disabled):active .bw-box{transform:scale(.92)}
.bw-who{width:var(--bw-s,28px);height:var(--bw-s,28px);border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:11px;font-weight:600;flex:none}
.bw-duo{display:flex;justify-content:flex-end;--bw-s:24px}
.bw-duo>*+*{margin-left:-7px;box-shadow:0 0 0 2px var(--card)}
.bw-duo>span.bw-who{font-size:calc(var(--bw-s) * .38)}
.bw-cd{text-align:right;font-family:var(--font-serif);font-size:19px;white-space:nowrap}
.bw-cd.m{font-family:inherit;font-size:12px;color:var(--w3)}
.bw-docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(36px,1fr));gap:10px 8px}
.bw-doc{aspect-ratio:1/1.12;border-radius:8px;background:color-mix(in srgb,var(--w) 6%,var(--card));display:grid;place-items:center;position:relative;color:var(--w3)}
.bw-doc i{position:absolute;right:-3px;top:-3px;width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 2px var(--card)}
.bw-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 13px 6px 7px;border-radius:999px;background:color-mix(in srgb,var(--bw-ok) 11%,transparent);color:color-mix(in srgb,var(--bw-ok) 72%,var(--w));font-size:13px;font-weight:500;max-width:100%}
.bw-pill b{width:18px;height:18px;border-radius:50%;background:var(--bw-ok);display:grid;place-items:center;color:#fff;flex:none}
.bw-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:52px;border:0;border-radius:14px;background:var(--w);color:var(--bg);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 10px 24px -14px color-mix(in srgb,var(--w) 60%,transparent);transition:transform .25s var(--bw-ease),box-shadow .25s var(--bw-ease)}
.bw-btn svg,.bw-link svg:last-child{transition:transform .25s var(--bw-ease)}
.bw-btn:hover{transform:translateY(-1px);box-shadow:0 14px 28px -14px color-mix(in srgb,var(--w) 70%,transparent)}
.bw-btn:hover svg,.bw-link:hover svg:last-child{transform:translateX(3px)}
.bw-btn:active{transform:scale(.985)}
.bw-link{display:inline-flex;align-items:center;gap:6px;min-height:32px;font-size:13px;color:var(--w3);text-decoration:none;background:none;border:0;cursor:pointer;font-family:inherit;padding:0;transition:color .2s var(--bw-ease)}
.bw-link:hover{color:var(--w)}
.bw-bar{display:block;height:5px;border-radius:3px;background:var(--bw-hair);overflow:hidden}
.bw-bar>span{display:block;height:100%;border-radius:3px;transition:width .6s var(--bw-ease)}
.bw-chev{color:var(--w3);transition:transform .3s var(--bw-ease)}
.bw-cols{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;margin-top:26px}
.bw-cols>*{min-width:0}
.bw{max-width:100%;min-width:0}
@media (max-width:760px){.bw-cols{grid-template-columns:minmax(0,1fr)}.bw-card{padding:18px 18px}.bw-road{gap:12px}.bw-grp>small{font-size:9.5px;letter-spacing:.12em}}
@media (prefers-reduced-motion:no-preference){
.bw-st.n{animation:bwPulse 2.4s ease-in-out infinite}
.bw-in{animation:bwIn .55s var(--bw-ease) both}
.bw-row.d .bw-box svg{animation:bwPop .3s var(--bw-ease) both}
.bw-open{animation:bwIn .3s var(--bw-ease) both}
}
@media (prefers-reduced-motion:reduce){.bw *{transition:none!important}}
@keyframes bwPulse{50%{box-shadow:0 0 0 9px var(--gdim)}}
@keyframes bwIn{from{opacity:0;transform:translateY(8px)}}
@keyframes bwPop{from{opacity:0;transform:scale(.4)}}
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
  // her German / her milestones: shown at once, saved, the truth reloaded after
  const put = useCallback(async (kind: "lang" | "marks", patch: Partial<LangInfo> | Partial<Marks>) => {
    setD((cur) => (cur ? { ...cur, input: { ...cur.input, [kind]: { ...(cur.input[kind] ?? {}), ...patch } } } : cur));
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (tok) await fetch(`/api/portal/${kind}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ ...(userId ? { userId } : {}), ...patch }) }).catch(() => null);
    void load();
  }, [userId, load]);
  const setDate = useCallback(async (kind: "submitted" | "flight" | "start", value: string) => {
    setD((cur) => (cur ? { ...cur, input: { ...cur.input, dates: { ...cur.input.dates, [kind]: value } } } : cur));
    const [path, field] = kind === "submitted" ? ["visa", "submitted"] : kind === "flight" ? ["move", "flight_date"] : ["arrival", "start"];
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (tok) await fetch(`/api/portal/${path}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ ...(userId ? { userId } : {}), [field]: value }) }).catch(() => null);
    void load();
  }, [userId, load]);
  return { d, way, toggle, put, setDate };
}

const SHOW_PLAN_LINK = false as boolean;
/** the old stacked right-hand column of the board (cards under cards) — hidden, the tabs replace it */
const SHOW_LEGACY_BOARD = false as boolean;
/** the dates each station needs, and their names */
const DATES: Partial<Record<WayKey, ("submitted" | "flight" | "start")[]>> = { visa: ["submitted"], trip: ["flight", "start"], arrive: ["start"] };
const DATE_NAME: Record<"submitted" | "flight" | "start", Record<L, string>> = {
  submitted: { de: "Abgegeben am", en: "Handed in on", fr: "Déposé le" },
  flight: { de: "Flug", en: "Flight", fr: "Vol" },
  start: { de: "Erster Arbeitstag", en: "First working day", fr: "Premier jour de travail" },
};
const ETA_ICON: Record<Eta["kind"], string> = { visa: "visa", flight: "trip", start: "trip", probation: "stay", exam: "lang", kp: "kp" };
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
      <div className="bw-grp" style={{ flex: `${st.length} 1 auto` }}>
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
  // after landing: the way there folds to one "geschafft"; Deutsch moves along if B2 is still open (B1 path)
  if (way.landed) {
    const langOpen = way.stations.some((s) => s.key === "lang" && !s.done);
    const ger: WayKey[] = [...(langOpen ? (["lang"] as WayKey[]) : []), ...WAY_GERMANY];
    return (
      <div className="bw-road" style={{ ["--bw-d" as string]: compact ? "26px" : "clamp(30px,6vw,40px)", ["--bw-now" as string]: compact ? "34px" : "clamp(40px,8vw,52px)", gap: compact ? 10 : undefined } as React.CSSProperties}
        role="img" aria-label={[t.abroad, ...ger.map((k) => WAY_NAME[k][l])].join(" → ")}>
        <div className="bw-grp" style={{ flex: "none" }}>
          {!compact && <small>{t.abroad}</small>}
          <div className="bw-line"><span className="bw-st f" title={`${t.abroad} · ${t.doneAll}`}><WayIcon k="chk" size={compact ? 12 : 17} stroke={2.4} /></span></div>
        </div>
        {grp(t.germany, ger)}
      </div>
    );
  }
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
  const { d, way, put, toggle } = useWay();
  const [view, setView] = useState<"home" | "steps" | "lang" | "talk" | "profile" | "start" | "salary">("home");
  // her next job interview (founder 2026-11-12, "Gespräche" sample 3): a button only while one is coming up
  const { talk } = useTalk();
  const talkSoon = !!talk && (talkDays(talk.at) ?? -1) >= 0;
  // her first working day (founder 2026-11-12, "Arbeitsstart" sample 1): a button once the date is set and still ahead
  const { start } = useStart();
  const startSoon = !!start?.date && (talkDays(start.date + "T00:00") ?? -1) >= 0;
  const first = (name || "").trim().split(/\s+/)[0] ?? "";
  const go = () => {
    if (!way) return;
    if (way.ticks.length > 0) setView("steps"); else onDocs?.();
  };
  const cur = way?.stations.find((s) => s.key === way.now);
  const langSt = way?.stations.find((s) => s.key === "lang");
  const langCard = !!(langSt && !langSt.done && d?.input.lang);
  // the soonest other date (the language card shows its own exam date)
  const land = way ? way.upcoming.find((e) => e.kind !== way.nowEta?.kind && !(langCard && e.kind === "exam")) ?? null : null;
  return (
    <section className="bw" aria-label={t.hi} style={{ maxWidth: 440, margin: "0 auto 34px", textAlign: "center" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, textAlign: "left" }}>
        <h1 className="serif" style={{ margin: 0, minWidth: 0, fontSize: 34, fontWeight: 400, lineHeight: 1.08, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{t.hi}{first ? ` ${first}` : ""}.</h1>
        {d?.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={d.photo} alt="" style={{ width: 46, height: 46, flex: "none", borderRadius: "50%", objectFit: "cover", boxShadow: "0 0 0 3px var(--card), 0 6px 16px -8px rgba(0,0,0,.3)" }} />
          : null}
      </div>
      {way && view !== "home" && (
        <div className="bw-in" style={{ marginTop: 22, textAlign: "left" }}>
          <button type="button" onClick={() => setView("home")} className="bw-link" style={{ marginBottom: 14 }}>
            <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><WayIcon k="arr" size={14} /></span>{l === "de" ? "Zurück" : l === "fr" ? "Retour" : "Back"}
          </button>
          {view === "steps" && (
            <div className="bw-card">
              <div className="serif" style={{ fontSize: 24, marginBottom: 8 }}>{WAY_NAME[way.now][l]}</div>
              <Ticks ticks={way.ticks} onTick={(id, done) => toggle(way.now, id, done)} photo={d?.photo ?? null} name={name} firstEta={way.nowEta} today={d!.today} />
            </div>
          )}
          {view === "lang" && d?.input.lang && <LangCard lang={d.input.lang} b2={d.input.b2} full={false} canEdit today={d.today} onSave={(p) => put("lang", p)} />}
          {view === "talk" && <div className="bw-card"><TalkView /></div>}
          {view === "profile" && <div className="bw-card"><ProfileCard name={name} photo={d?.photo ?? null} cvHref="/portal/cv-builder" /></div>}
          {view === "start" && <div className="bw-card"><StartView /></div>}
          {view === "salary" && <div className="bw-card"><SalaryView /></div>}
        </div>
      )}
      {way && view === "home" && (
        <div className="bw-in">
          {way.win && <div style={{ marginTop: 18 }}><span className="bw-pill"><b><WayIcon k="chk" size={11} stroke={2.6} /></b>{WAY_WIN[way.win][l]}</span></div>}
          <div style={{ width: 128, height: 128, margin: "34px auto 0", borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--gold) 11%, var(--card))", color: "var(--gold)", boxShadow: "0 0 0 12px color-mix(in srgb, var(--gold) 5%, transparent)" }}>
            <WayIcon k={way.now} size={52} stroke={1.15} />
          </div>
          <div className="serif" style={{ marginTop: 26, fontSize: 24, lineHeight: 1.15 }}>{way.nowEta ? ETA_NAME[way.nowEta.kind][l] : way.next ? stepName(way.next, l) : WAY_NAME[way.now][l]}</div>
          {way.nowEta ? (
            <>
              <div className="serif" style={{ marginTop: 6, fontSize: 46, lineHeight: 1.05, letterSpacing: "-.01em" }}>{until(d!.today, way.nowEta.date, l).word}</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--w3)" }}>{shortDate(way.nowEta.date, l)}{way.nowEta.est ? ` · ${t.est}` : ""}</div>
            </>
          ) : cur ? (
            <div className="serif" style={{ marginTop: 8, fontSize: 30, lineHeight: 1, color: "var(--w2)" }}>{fmt(t.of, cur.p[0], cur.p[1])}</div>
          ) : null}
          <button type="button" className="bw-btn" style={{ marginTop: 26 }} onClick={go}>{t.next} <WayIcon k="arr" size={18} /></button>
          <div style={{ marginTop: 26, display: "flex", justifyContent: "center" }}><div style={{ width: "100%", maxWidth: 360 }}><WayLine way={way} compact /></div></div>
          {land && (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", gap: "4px 10px", marginTop: 22, fontSize: 13, color: "var(--w3)" }}>
              <span style={{ color: "var(--gold)", alignSelf: "center", display: "inline-flex" }}><WayIcon k={ETA_ICON[land.kind]} size={18} /></span>{ETA_NAME[land.kind][l]}
              <b className="serif" style={{ fontWeight: 400, fontSize: 20, color: "var(--w)" }}>{until(d!.today, land.date, l).word}</b>
            </div>
          )}
          {/* Deutsch and her papers: one tap each, their own view (no scrolling) */}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
            {startSoon && (
              <button type="button" onClick={() => setView("start")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--w)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k="bld" size={16} /></span>{l === "de" ? "Arbeitsstart" : l === "fr" ? "Premier jour" : "First day"}
              </button>
            )}
            {/* her first salary (sample 3): once her first working day is set */}
            {!!start?.date && (
              <button type="button" onClick={() => setView("salary")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex", fontWeight: 600 }}>€</span>{l === "de" ? "Gehalt" : l === "fr" ? "Salaire" : "Salary"}
              </button>
            )}
            {talkSoon && (
              <button type="button" onClick={() => setView("talk")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--w)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k="talk" size={16} /></span>{l === "de" ? "Gespräch" : l === "fr" ? "Entretien" : "Interview"}
              </button>
            )}
            {langCard && (
              <button type="button" onClick={() => setView("lang")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k="lang" size={16} /></span>{t.lang}
              </button>
            )}
            {onDocs && (
              <button type="button" onClick={onDocs} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k="papers" size={16} /></span>{t.papers}
              </button>
            )}
            {/* her profile card, as the Einrichtungen see it (founder 2026-11-12, "Profil" sample 1) */}
            <button type="button" onClick={() => setView("profile")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k="user" size={16} /></span>{l === "de" ? "Profil" : l === "fr" ? "Profil" : "Profile"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** ‹ 1 / 3 › — flip instead of scroll */
export function Flip({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const b = (dis: boolean): React.CSSProperties => ({ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: dis ? "var(--border)" : "var(--w2)", cursor: dis ? "default" : "pointer", display: "grid", placeItems: "center" });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, margin: "0 0 6px" }}>
      <button type="button" aria-label="‹" disabled={page <= 0} onClick={() => onPage(page - 1)} style={b(page <= 0)}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><WayIcon k="arr" size={14} /></span></button>
      <span style={{ fontSize: 12, color: "var(--w3)", minWidth: 36, textAlign: "center" }}>{page + 1} / {pages}</span>
      <button type="button" aria-label="›" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} style={b(page >= pages - 1)}><WayIcon k="arr" size={14} /></button>
    </div>
  );
}

/* ── her page, for the facility and Borivon ─────────────────────────────────── */
function Who({ who, photo, name }: { who: Tick["who"]; photo: string | null; name: string }) {
  const l = useL();
  const t = W[l];
  const nurse = photo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="bw-who" src={photo} alt="" />
    : <span className="bw-who" style={{ background: "color-mix(in srgb, var(--gold) 14%, var(--card))", color: "var(--gold)" }}>{initials(name)}</span>;
  const fac = <span className="bw-who" style={{ background: "var(--w)", color: "var(--bg)" }}><WayIcon k="bld" size={13} /></span>;
  return (
    <span title={who === "nurse" ? name || t.nurse : who === "facility" ? t.facility : t.both} className="bw-duo" style={who === "both" ? undefined : ({ ["--bw-s" as string]: "28px" } as React.CSSProperties)}>
      {who !== "nurse" && fac}
      {who !== "facility" && nurse}
    </span>
  );
}

function Ticks({ ticks, onTick, photo, name, firstEta, today }: { ticks: Tick[]; onTick: (id: string, done: boolean) => void; photo: string | null; name: string; firstEta: Eta | null; today: string }) {
  const l = useL();
  const at = firstEta ? ETA_STEP[firstEta.kind] : undefined;
  // no scrolling (founder 2026-11-11): at most 6 rows, the rest one flip away; open on the page with the first open step
  const PER = 6;
  const pages = Math.max(1, Math.ceil(ticks.length / PER));
  const firstOpenIdx = Math.max(0, ticks.findIndex((x) => !x.done));
  const [pg, setPg] = useState(() => Math.min(pages - 1, Math.floor(firstOpenIdx / PER)));
  const page = Math.min(pg, pages - 1);
  return (
    <div className="bw-rows">
      {pages > 1 && <Flip page={page} pages={pages} onPage={setPg} />}
      {ticks.slice(page * PER, page * PER + PER).map((x) => (
        <button key={x.id} type="button" className={`bw-row ${x.done ? "d" : ""}`} onClick={() => onTick(x.id, !x.done)} aria-pressed={x.done}>
          <span className="bw-box">{x.done && <WayIcon k="chk" size={13} stroke={2.4} />}</span>
          <span className="bw-nm">{stepName(x.id, l)}</span>
          {!x.done && x.id === at && firstEta ? (() => { const u = until(today, firstEta.date, l); return <span className="bw-cd">{firstEta.est ? "~ " : ""}{u.n ? `${u.n} ${u.unit}` : u.unit}</span>; })()
            : <span />}
          <Who who={x.who} photo={photo} name={name} />
        </button>
      ))}
    </div>
  );
}

export function WayBoard({ userId, name, onDocs }: { userId: string; name: string; onDocs?: () => void }) {
  const l = useL();
  const t = W[l];
  const { d, way, toggle, put, setDate } = useWay(userId);
  const [flatOpen, setFlatOpen] = useState(true);
  const [panel, setPanel] = useState<"now" | "home" | "contract" | "lang" | "kp" | "talk" | "profile" | "start" | "salary">("now");
  if (!d || !way) return null;
  const cur = way.stations.find((s) => s.key === way.now)!;
  const docs = d.input.docs;
  const b2 = d.input.b2;
  const plan = `/portal/admin/ankunft/${userId}?name=${encodeURIComponent(name)}`;
  const home = way.home;
  const homeDone = home.filter((h) => h.done).length;
  const showFlat = !way.landed;
  const marks = d.input.marks ?? null;
  const canEdit = !!d.admin;
  const head = way.eta ?? way.upcoming[0] ?? null;
  const docP = docs ? (way.now === "recog" ? docs.bearbeitung : way.now === "visa" && docs.visum[1] > 0 ? docs.visum : docs.papers) : null;

  return (
    <section className="bw bw-in" aria-label={name}>
      <style>{CSS}</style>
      <WayLine way={way} />

      {/* one panel, switched by small tabs (founder 2026-11-11: "no one wants to scroll … flip to the next side") */}
      {(() => {
        const tabs: { k: typeof panel; icon: string; label: string; badge?: string; on: boolean }[] = [
          { k: "now", icon: way.now, label: WAY_NAME[way.now][l], badge: way.ticks.length > 0 ? `${cur.p[0]}/${cur.p[1]}` : undefined, on: true },
          { k: "home", icon: "home", label: t.flat, badge: `${homeDone}/${home.length}`, on: showFlat },
          { k: "contract", icon: "contract", label: l === "de" ? "Vertrag" : l === "fr" ? "Contrat" : "Contract", badge: marks?.contract ? "✓" : undefined, on: !way.landed && !!marks },
          { k: "lang", icon: "lang", label: t.lang, on: !!d.input.lang },
          { k: "talk", icon: "talk", label: l === "de" ? "Gespräch" : l === "fr" ? "Entretien" : "Interview", on: canEdit && !way.landed },
          { k: "profile", icon: "user", label: l === "de" ? "Profil" : l === "fr" ? "Profil" : "Profile", on: true },
          { k: "start", icon: "bld", label: l === "de" ? "Arbeitsstart" : l === "fr" ? "Premier jour" : "First day", on: canEdit && !way.landed },
          { k: "salary", icon: "contract", label: l === "de" ? "Gehalt" : l === "fr" ? "Salaire" : "Salary", on: canEdit },
          { k: "kp", icon: "kp", label: l === "de" ? "Kenntnisprüfung" : l === "fr" ? "Examen" : "Knowledge test", on: !!marks && (way.landed || !!marks.kp_date) },
        ];
        const shown = tabs.filter((x) => x.on);
        const cur2 = shown.find((x) => x.k === panel) ? panel : "now";
        const tabBtn = (on: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 13px", borderRadius: 999, border: `1px solid ${on ? "var(--w)" : "var(--border)"}`, background: on ? "var(--w)" : "var(--card)", color: on ? "var(--bg)" : "var(--w2)", fontSize: 13, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", flex: "none", fontFamily: "inherit" });
        return (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "18px 0 10px" }}>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", minWidth: 0, flex: 1 }} role="tablist">
              {shown.map((x) => (
                <button key={x.k} type="button" role="tab" aria-selected={cur2 === x.k} onClick={() => setPanel(x.k)} style={tabBtn(cur2 === x.k)}>
                  <WayIcon k={x.icon} size={15} />{x.label}{x.badge && <span style={{ opacity: 0.6, fontSize: 12 }}>{x.badge}</span>}
                </button>
              ))}
              {onDocs && (
                <button type="button" onClick={onDocs} style={tabBtn(false)}>
                  <WayIcon k="papers" size={15} />{t.papers}{(docs?.pending ?? 0) > 0 && <i style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />}
                </button>
              )}
            </div>
            {/* the outcome, small and always in view: when she starts */}
            {head && (
              <span title={ETA_NAME[head.kind][l]} style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none", paddingLeft: 8 }}>
                <span style={{ color: "var(--gold)", display: "inline-flex" }}><WayIcon k={ETA_ICON[head.kind]} size={17} /></span>
                <span style={{ fontSize: 12, color: "var(--w3)" }}>{ETA_NAME[head.kind][l]}</span>
                <b className="serif" style={{ fontWeight: 400, fontSize: 21, whiteSpace: "nowrap" }}>{head.est ? "~ " : ""}{until(d.today, head.date, l).word}</b>
              </span>
            )}
            </div>
            {cur2 === "now" && (
        <div className="bw-card" style={{ display: "flex", flexDirection: "column" }}>
          {way.now === "visa" && docs && docs.visum[1] > 0 && (
            <button type="button" className={`bw-row ${docs.visum[0] >= docs.visum[1] ? "d" : ""}`} style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }} onClick={onDocs}>
              <span className="bw-box">{docs.visum[0] >= docs.visum[1] && <WayIcon k="chk" size={13} stroke={2.4} />}</span>
              <span className="bw-nm">{t.visaPapers}</span>
              <span className="bw-cd" style={{ color: "var(--w2)" }}>{docs.visum[0]}<span style={{ fontSize: 13, color: "var(--w3)" }}> / {docs.visum[1]}</span></span>
              <span className="bw-duo" style={{ color: "var(--w3)" }}><span className="bw-who" style={{ ["--bw-s" as string]: "28px" } as React.CSSProperties}><WayIcon k="papers" size={17} /></span></span>
            </button>
          )}
          {way.ticks.length > 0
            ? <Ticks ticks={way.ticks} onTick={(id, done) => toggle(way.now, id, done)} photo={d.photo} name={name} firstEta={way.nowEta} today={d.today} />
            : docP && (
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 0 18px" }}>
                  <span className="serif" style={{ fontSize: 44, lineHeight: 1 }}>{docP[0]}</span>
                  <span className="serif" style={{ fontSize: 22, color: "var(--w3)" }}>/ {docP[1]}</span>
                </div>
                <div className="bw-docs">
                  {Array.from({ length: Math.min(docP[1], 30) }, (_, i) => (
                    <span key={i} className="bw-doc"><WayIcon k="papers" size={15} stroke={1.3} />{i < docP[0] && <i style={{ background: "var(--bw-ok)" }} />}</span>
                  ))}
                </div>
                {way.now === "papers" && (docs?.pending ?? 0) > 0 && <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 16, fontSize: 12.5, color: "var(--w2)" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />{t.wait.replace("{n}", String(docs!.pending))}</span>}
                {onDocs && <button type="button" className="bw-btn" style={{ marginTop: 20, height: 46, fontSize: 14 }} onClick={onDocs}>{t.open} <WayIcon k="arr" size={16} /></button>}
              </div>
            )}
          {/* the dates that drive the countdowns, set right here (the long plan page stays hidden) */}
          {DATES[way.now] && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {DATES[way.now]!.map((k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w2)" }}>
                  {DATE_NAME[k][l]}<DatePick value={d.input.dates[k]} label={DATE_NAME[k][l]} onChange={(v) => setDate(k, v)} />
                </span>
              ))}
            </div>
          )}
          {SHOW_PLAN_LINK && <div style={{ marginTop: "auto", paddingTop: 14, textAlign: "right" }}><a className="bw-link" href={plan}><WayIcon k="cal" size={15} />{t.plan}<WayIcon k="arr" size={14} /></a></div>}
        </div>
            )}
            {cur2 === "home" && (
              <div className="bw-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <span className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{t.flat}</span>
                  <span style={{ fontSize: 12, color: "var(--w3)" }}>{t.flatSub}</span>
                </div>
                <Ticks ticks={home} onTick={(id, done) => toggle("home", id, done)} photo={d.photo} name={name} firstEta={null} today={d.today} />
              </div>
            )}
            {cur2 === "contract" && marks && <ContractCard marks={marks} canEdit={canEdit} onSave={(p) => put("marks", p)} />}
            {cur2 === "lang" && d.input.lang && <LangCard lang={d.input.lang} b2={b2} full={canEdit} canEdit={canEdit} today={d.today} onSave={(p) => put("lang", p)} />}
            {cur2 === "talk" && <div className="bw-card"><TalkView userId={userId} /></div>}
            {cur2 === "start" && <div className="bw-card"><StartView userId={userId} /></div>}
            {cur2 === "salary" && <div className="bw-card"><SalaryView userId={userId} /></div>}
            {cur2 === "profile" && <div className="bw-card"><ProfileCard userId={userId} name={name} photo={d.photo ?? null} cvHref={`/portal/cv-builder?candidateId=${userId}`} /></div>}
            {cur2 === "kp" && marks && <KpCard marks={marks} canEdit={canEdit} today={d.today} onSave={(p) => put("marks", p)} />}
          </>
        );
      })()}
      {SHOW_LEGACY_BOARD && (
      <div className="bw-cols">
        {/* the station she is at: who does what, tap to tick */}
        <div className="bw-card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <span className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{WAY_NAME[way.now][l]}</span>
            {way.ticks.length > 0 && <span style={{ fontSize: 12, color: "var(--w3)", whiteSpace: "nowrap" }}>{fmt(t.of, cur.p[0], cur.p[1])}</span>}
          </div>
          {way.now === "visa" && docs && docs.visum[1] > 0 && (
            <button type="button" className={`bw-row ${docs.visum[0] >= docs.visum[1] ? "d" : ""}`} style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }} onClick={onDocs}>
              <span className="bw-box">{docs.visum[0] >= docs.visum[1] && <WayIcon k="chk" size={13} stroke={2.4} />}</span>
              <span className="bw-nm">{t.visaPapers}</span>
              <span className="bw-cd" style={{ color: "var(--w2)" }}>{docs.visum[0]}<span style={{ fontSize: 13, color: "var(--w3)" }}> / {docs.visum[1]}</span></span>
              <span className="bw-duo" style={{ color: "var(--w3)" }}><span className="bw-who" style={{ ["--bw-s" as string]: "28px" } as React.CSSProperties}><WayIcon k="papers" size={17} /></span></span>
            </button>
          )}
          {way.ticks.length > 0
            ? <Ticks ticks={way.ticks} onTick={(id, done) => toggle(way.now, id, done)} photo={d.photo} name={name} firstEta={way.nowEta} today={d.today} />
            : docP && (
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "6px 0 18px" }}>
                  <span className="serif" style={{ fontSize: 44, lineHeight: 1 }}>{docP[0]}</span>
                  <span className="serif" style={{ fontSize: 22, color: "var(--w3)" }}>/ {docP[1]}</span>
                </div>
                <div className="bw-docs">
                  {Array.from({ length: Math.min(docP[1], 30) }, (_, i) => (
                    <span key={i} className="bw-doc"><WayIcon k="papers" size={15} stroke={1.3} />{i < docP[0] && <i style={{ background: "var(--bw-ok)" }} />}</span>
                  ))}
                </div>
                {way.now === "papers" && (docs?.pending ?? 0) > 0 && <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 16, fontSize: 12.5, color: "var(--w2)" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />{t.wait.replace("{n}", String(docs!.pending))}</span>}
                {onDocs && <button type="button" className="bw-btn" style={{ marginTop: 20, height: 46, fontSize: 14 }} onClick={onDocs}>{t.open} <WayIcon k="arr" size={16} /></button>}
              </div>
            )}
          {/* the dates that drive the countdowns, set right here (the long plan page stays hidden) */}
          {DATES[way.now] && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {DATES[way.now]!.map((k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w2)" }}>
                  {DATE_NAME[k][l]}<DatePick value={d.input.dates[k]} label={DATE_NAME[k][l]} onChange={(v) => setDate(k, v)} />
                </span>
              ))}
            </div>
          )}
          {SHOW_PLAN_LINK && <div style={{ marginTop: "auto", paddingTop: 14, textAlign: "right" }}><a className="bw-link" href={plan}><WayIcon k="cal" size={15} />{t.plan}<WayIcon k="arr" size={14} /></a></div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignContent: "start" }}>
          {/* the flat, beside the visa */}
          {showFlat && (
            <div className="bw-card">
              <button type="button" onClick={() => setFlatOpen((o) => !o)} aria-expanded={flatOpen} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span className="bw-tile" style={{ width: 46, height: 46 }}><WayIcon k="home" size={20} /></span>
                <span style={{ flex: 1, minWidth: 0 }}><span className="serif" style={{ display: "block", fontSize: 22, lineHeight: 1.15 }}>{t.flat}</span><span style={{ fontSize: 12.5, color: "var(--w3)" }}>{t.flatSub}</span></span>
                <span className="serif" style={{ fontSize: 28, whiteSpace: "nowrap" }}>{homeDone}<span style={{ fontSize: 16, color: "var(--w3)" }}> / {home.length}</span></span>
                <span className="bw-chev" style={{ display: "inline-flex", transform: flatOpen ? "rotate(180deg)" : undefined }}><WayIcon k="dn" size={16} /></span>
              </button>
              <span aria-hidden="true" className="bw-bar" style={{ marginTop: 16 }}>
                <span style={{ width: `${home.length ? (homeDone / home.length) * 100 : 0}%`, background: homeDone === home.length ? "var(--bw-ok)" : "var(--gold)" }} />
              </span>
              {flatOpen && <div className="bw-open" style={{ marginTop: 8 }}><Ticks ticks={home} onTick={(id, done) => toggle("home", id, done)} photo={d.photo} name={name} firstEta={null} today={d.today} /></div>}
            </div>
          )}

          {/* before landing: the contract */}
          {!way.landed && marks && <ContractCard marks={marks} canEdit={canEdit} onSave={(p) => put("marks", p)} />}

          {/* papers as tiles; the count that waits for you in orange. After landing: the three that matter */}
          {way.landed ? <KeyPapers onDocs={onDocs} /> : docs && way.now !== "papers" && (
            <button type="button" className="bw-card" onClick={onDocs} style={{ textAlign: "left", cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
                <span className="serif" style={{ fontSize: 22, lineHeight: 1.15 }}>{t.papers}</span>
                <span style={{ fontSize: 12, color: "var(--w3)", whiteSpace: "nowrap" }}>{docs.papers[0]} / {docs.papers[1]}</span>
              </span>
              <span className="bw-docs">
                {Array.from({ length: Math.min(docs.papers[1], 24) }, (_, i) => (
                  <span key={i} className="bw-doc"><WayIcon k="papers" size={15} stroke={1.3} />{i < docs.papers[0] && <i style={{ background: "var(--bw-ok)" }} />}</span>
                ))}
              </span>
              {(docs.pending ?? 0) > 0 && <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 16, fontSize: 12.5, color: "var(--w2)" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />{t.wait.replace("{n}", String(docs.pending))}</span>}
            </button>
          )}

          {/* Deutsch: ladder, the four modules, the exam */}
          {d.input.lang && (b2 || d.input.lang.level || d.input.lang.exam_date || !way.landed) && (
            <LangCard lang={d.input.lang} b2={b2} full={canEdit} canEdit={canEdit} today={d.today} onSave={(p) => put("lang", p)} />
          )}

          {/* after landing (or once a date is set): Kenntnisprüfung → Berufsurkunde */}
          {marks && (way.landed || marks.kp_date) && <KpCard marks={marks} canEdit={canEdit} today={d.today} onSave={(p) => put("marks", p)} />}
        </div>
      </div>
      )}
    </section>
  );
}

/** one row of the facility list: where she is, as dots; what comes next; WANN */
export type WayRow = { st: [WayKey, 0 | 1 | 2][]; now: WayKey; p: [number, number]; next: string | null; eta: Eta | null; today: string; wins?: { kind: string; at: string }[] };
export function WayDots({ row }: { row: WayRow }) {
  return (
    <span style={{ display: "flex", alignItems: "center", height: 17 }} aria-hidden="true">
      {row.st.map(([k, s], i) => (
        <span key={k} style={{ display: "contents" }}>
          {i > 0 && <span style={{ flex: 1, minWidth: 4, height: 1.5, background: s >= 1 && row.st[i - 1][1] === 2 ? "var(--w)" : "color-mix(in srgb, var(--w) 13%, transparent)", marginLeft: k === "arrive" ? 6 : 0 }} />}
          <span style={{ width: s === 1 ? 11 : 7, height: s === 1 ? 11 : 7, borderRadius: "50%", flex: "none", boxSizing: "border-box",
            background: s === 2 ? "var(--w)" : s === 1 ? "var(--card)" : "color-mix(in srgb, var(--w) 18%, var(--card))", border: s === 1 ? "2px solid var(--gold)" : "0",
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
      <span className="bw-tile" style={{ width: 36, height: 36, borderRadius: 10, flex: "none", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--gold) 9%, var(--card))", color: "var(--gold)" }}><WayIcon k={row.now} size={16} /></span>
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
