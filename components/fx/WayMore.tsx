"use client";

import { useRef, useState } from "react";
import { useLang } from "@/components/LangContext";
import { WayIcon } from "./Way";
import { until, shortDate } from "@/lib/facility/way";
import { LEVELS, MODULES, PROVIDERS, type LangInfo, type Marks, type ModState, type Module } from "@/lib/facility/track";
import { b2StageLabel, type B2Stage } from "@/lib/b2Journey";

/**
 * The small cards beside her way (components/fx/Way.tsx WayBoard / WayHero), founder 2026-11-11:
 *   Deutsch – "like the CV builder": ladder A1·A2·B1·B2 (goal B2, no C1), the four B2 modules (passed ✓ green,
 *             redo ✗ red, result pending orange – LAW #4), the exam as a countdown, provider, school, the
 *             path "arrives with B1, finishes B2 in Germany". The visual IS the control: tap a module.
 *   Vertrag, Kenntnisprüfung → Berufsurkunde – one tap ("Heute"), or a date.
 *   Wichtige Papiere – after landing, the three that matter stay one tap away.
 * Who may set what: app/api/portal/lang + marks (her facility / Borivon everything; she her exam date,
 * provider and school).
 */
type L = "de" | "en" | "fr";
const useL = (): L => { const { lang } = useLang(); return (["de", "en", "fr"].includes(lang) ? lang : "de") as L; };

const T = {
  de: { lang: "Deutsch", goal: "Ziel B2", mod: { lesen: "Lesen", hoeren: "Hören", schreiben: "Schreiben", sprechen: "Sprechen" }, st: { passed: "bestanden", failed: "wiederholen", pending: "Ergebnis kommt", "": "offen" }, exam: "Prüfung", school: "Sprachschule", b1: "B2 in Deutschland", b1Hint: "kommt mit B1, macht B2 in Deutschland", prov: { goethe: "Goethe", telc: "telc Pflege", oesd: "ÖSD", ecl: "ECL" }, edit: "Ändern", close: "Fertig", contract: "Vertrag", signed: "unterschrieben", today: "Heute", kp: "Kenntnis­prüfung", passed: "Bestanden", failed: "Nicht bestanden", urkunde: "Berufsurkunde", got: "da", papers: "Wichtige Papiere", pass: "Reisepass", cv: "Lebenslauf", vertrag: "Arbeitsvertrag", date: "Datum", tapMod: "Tippen: offen → Ergebnis kommt → bestanden → wiederholen" },
  en: { lang: "German", goal: "Goal B2", mod: { lesen: "Reading", hoeren: "Listening", schreiben: "Writing", sprechen: "Speaking" }, st: { passed: "passed", failed: "redo", pending: "result pending", "": "open" }, exam: "Exam", school: "Language school", b1: "B2 in Germany", b1Hint: "arrives with B1, does B2 in Germany", prov: { goethe: "Goethe", telc: "telc Nursing", oesd: "ÖSD", ecl: "ECL" }, edit: "Edit", close: "Done", contract: "Contract", signed: "signed", today: "Today", kp: "Knowledge test", passed: "Passed", failed: "Not passed", urkunde: "Licence", got: "received", papers: "Key papers", pass: "Passport", cv: "CV", vertrag: "Work contract", date: "Date", tapMod: "Tap: open → result pending → passed → redo" },
  fr: { lang: "Allemand", goal: "Objectif B2", mod: { lesen: "Lire", hoeren: "Écouter", schreiben: "Écrire", sprechen: "Parler" }, st: { passed: "réussi", failed: "à refaire", pending: "résultat attendu", "": "à faire" }, exam: "Examen", school: "École de langue", b1: "B2 en Allemagne", b1Hint: "arrive avec B1, fait le B2 en Allemagne", prov: { goethe: "Goethe", telc: "telc Soins", oesd: "ÖSD", ecl: "ECL" }, edit: "Modifier", close: "Terminé", contract: "Contrat", signed: "signé", today: "Aujourd’hui", kp: "Examen de connaissances", passed: "Réussi", failed: "Échoué", urkunde: "Autorisation d’exercer", got: "reçue", papers: "Papiers importants", pass: "Passeport", cv: "CV", vertrag: "Contrat de travail", date: "Date", tapMod: "Toucher : à faire → résultat attendu → réussi → à refaire" },
};
const MOD_ICON: Record<Module, string> = { lesen: "book", hoeren: "ear", schreiben: "pen", sprechen: "talk" };
const NEXT_STATE: Record<ModState, ModState> = { "": "pending", pending: "passed", passed: "failed", failed: "" };
// LAW #4: green done, orange waiting, red failed
const COL: Record<ModState, string> = { passed: "#16a34a", failed: "#dc2626", pending: "#f59e0b", "": "var(--border)" };
const todayIso = () => new Date().toISOString().slice(0, 10);

const tileS: React.CSSProperties = { width: 46, height: 46, borderRadius: 12, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--gold) 9%, var(--card))", color: "var(--gold)", flex: "none" };
const dateS: React.CSSProperties = { height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--w)", fontFamily: "inherit", fontSize: 13 };
const chipS = (on: boolean): React.CSSProperties => ({ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? "var(--w)" : "var(--border)"}`, background: on ? "var(--w)" : "var(--card)", color: on ? "var(--bg)" : "var(--w2)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" });
const linkS: React.CSSProperties = { background: "none", border: 0, padding: 0, color: "var(--w3)", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };

function When({ date, today }: { date: string; today: string }) {
  const l = useL();
  const u = until(today, date, l);
  return (
    <span style={{ textAlign: "right", lineHeight: 1, flex: "none" }}>
      <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 22 }}>{u.word}</span>
      <span style={{ display: "block", marginTop: 4, fontSize: 11.5, color: "var(--w3)" }}>{shortDate(date, l)}</span>
    </span>
  );
}

/** a date as a quiet chip (or a calendar icon when empty) that opens the browser's date picker */
export function DatePick({ value, label, onChange }: { value: string; label: string; onChange: (d: string) => void }) {
  const l = useL();
  const ref = useRef<HTMLInputElement>(null);
  const open = () => { const el = ref.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); el.click(); } };
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <button type="button" onClick={open} aria-label={label} title={label}
        style={{ ...chipS(false), display: "inline-flex", alignItems: "center", gap: 6, padding: value ? "0 12px" : "0 9px" }}>
        <WayIcon k="cal" size={15} />{value ? shortDate(value, l) : null}
      </button>
      <input ref={ref} type="date" tabIndex={-1} aria-hidden="true" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
    </span>
  );
}

/* ── Deutsch ─────────────────────────────────────────────────────────────────── */
export function LangCard({ lang, b2, full, canEdit, today, onSave }: {
  lang: LangInfo; b2: { stage: B2Stage; failed: boolean } | null; full: boolean; canEdit: boolean; today: string;
  onSave: (patch: Partial<LangInfo>) => void;
}) {
  const l = useL();
  const t = T[l];
  const [open, setOpen] = useState(false);
  const passed = b2?.stage === "passed" || MODULES.every((k) => lang.modules[k] === "passed");
  const lvl = passed ? 3 : LEVELS.indexOf(lang.level as (typeof LEVELS)[number]);
  const examAhead = !passed && /^\d{4}-\d{2}-\d{2}$/.test(lang.exam_date) && lang.exam_date >= today;
  const sub = passed ? b2StageLabel("passed", l) : lang.path === "b1_de" ? t.b1Hint : [lang.provider ? t.prov[lang.provider] : "", lang.school].filter(Boolean).join(" · ") || (b2 ? b2StageLabel(b2.stage, l) : t.goal);
  return (
    <div className="bw-card">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={tileS}><WayIcon k="lang" size={20} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 22 }}>{t.lang}</span>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--w3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
        </span>
        {examAhead && <When date={lang.exam_date} today={today} />}
      </div>

      {/* the ladder: A1 · A2 · B1 · B2 (goal) */}
      <div style={{ display: "flex", gap: 6, marginTop: 16 }} role="group" aria-label={t.goal}>
        {LEVELS.map((lv, i) => {
          const on = i <= lvl;
          const goal = lv === "B2";
          return (
            <button key={lv} type="button" disabled={!full} onClick={() => onSave({ level: lang.level === lv ? "" : lv })}
              style={{ flex: 1, height: 34, borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: full ? "pointer" : "default",
                border: `1.5px solid ${on ? (passed && goal ? "#16a34a" : "var(--w)") : goal ? "var(--gold)" : "var(--border)"}`,
                background: on ? (passed && goal ? "#16a34a" : "var(--w)") : "var(--card)", color: on ? "var(--bg)" : goal ? "var(--gold)" : "var(--w3)" }}>
              {lv}
            </button>
          );
        })}
      </div>

      {/* the four B2 modules: the visual is the control */}
      {!passed && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginTop: 16 }}>
          {MODULES.map((m) => {
            const st = lang.modules[m];
            return (
              <button key={m} type="button" disabled={!full} title={full ? t.tapMod : `${t.mod[m]} · ${t.st[st]}`}
                onClick={() => onSave({ modules: { ...lang.modules, [m]: NEXT_STATE[st] } })}
                style={{ display: "grid", justifyItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: full ? "pointer" : "default", color: "var(--w2)", fontFamily: "inherit" }}>
                <span style={{ position: "relative", width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center",
                  border: `2px solid ${COL[st]}`, background: st === "passed" ? "rgba(22,163,74,.08)" : st === "failed" ? "rgba(220,38,38,.07)" : st === "pending" ? "rgba(245,158,11,.08)" : "var(--card)",
                  color: st ? COL[st] : "var(--w3)" }}>
                  <WayIcon k={MOD_ICON[m]} size={18} />
                  {st && <span style={{ position: "absolute", right: -3, bottom: -3, width: 17, height: 17, borderRadius: "50%", background: COL[st], color: "#fff", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, border: "2px solid var(--card)" }}>{st === "passed" ? "✓" : st === "failed" ? "↻" : "…"}</span>}
                </span>
                <span style={{ fontSize: 11.5 }}>{t.mod[m]}</span>
              </button>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button type="button" style={linkS} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? t.close : t.edit}</button>
        </div>
      )}
      {open && (
        <div style={{ display: "grid", gap: 12, marginTop: 10, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, color: "var(--w2)" }}>{t.exam}
            <input type="date" style={dateS} value={lang.exam_date} onChange={(e) => onSave({ exam_date: e.target.value })} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PROVIDERS.map((p) => <button key={p} type="button" style={chipS(lang.provider === p)} onClick={() => onSave({ provider: lang.provider === p ? "" : p })}>{t.prov[p]}</button>)}
          </div>
          <input type="text" placeholder={t.school} defaultValue={lang.school} maxLength={80} onBlur={(e) => { if (e.target.value !== lang.school) onSave({ school: e.target.value }); }}
            style={{ ...dateS, width: "100%" }} />
          {full && (
            <button type="button" style={chipS(lang.path === "b1_de")} onClick={() => onSave({ path: lang.path === "b1_de" ? "" : "b1_de" })}>{t.b1}</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── one milestone row: done (date) or one tap ───────────────────────────────── */
function Mark({ icon, name, date, canEdit, onSet, extra }: { icon: string; name: string; date: string; canEdit: boolean; onSet: (d: string) => void; extra?: React.ReactNode }) {
  const l = useL();
  const t = T[l];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ ...tileS, ...(date ? { background: "rgba(22,163,74,.1)", color: "#16a34a" } : {}) }}><WayIcon k={date ? "chk" : icon} size={20} stroke={date ? 2.2 : 1.5} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 21 }}>{name}</span>
        {date && !canEdit && <span style={{ fontSize: 12.5, color: "var(--w3)" }}>{shortDate(date, l)}</span>}
      </span>
      {extra}
      {canEdit && !date && <button type="button" style={chipS(false)} onClick={() => onSet(todayIso())}>{t.today}</button>}
      {canEdit && <DatePick value={date} label={`${name} · ${t.date}`} onChange={onSet} />}
    </div>
  );
}

export function ContractCard({ marks, canEdit, onSave }: { marks: Marks; canEdit: boolean; onSave: (p: Partial<Marks>) => void }) {
  const t = T[useL()];
  return <div className="bw-card"><Mark icon="contract" name={t.contract} date={marks.contract} canEdit={canEdit} onSet={(d) => onSave({ contract: d })} /></div>;
}

export function KpCard({ marks, canEdit, today, onSave }: { marks: Marks; canEdit: boolean; today: string; onSave: (p: Partial<Marks>) => void }) {
  const l = useL();
  const t = T[l];
  const ahead = /^\d{4}-\d{2}-\d{2}$/.test(marks.kp_date) && marks.kp_date >= today && !marks.kp_result;
  return (
    <div className="bw-card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ ...tileS, ...(marks.kp_result === "passed" ? { background: "rgba(22,163,74,.1)", color: "#16a34a" } : marks.kp_result === "failed" ? { background: "rgba(220,38,38,.08)", color: "#dc2626" } : {}) }}><WayIcon k="kp" size={20} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span lang="de" style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 21, hyphens: "manual", overflowWrap: "anywhere" }}>{t.kp}</span>
          {marks.kp_result && <span style={{ fontSize: 12.5, fontWeight: 600, color: marks.kp_result === "passed" ? "#16a34a" : "#dc2626" }}>{marks.kp_result === "passed" ? t.passed : t.failed}</span>}
          {ahead && <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 18, color: "var(--w)" }}>{until(today, marks.kp_date, l).word}</span>}
        </span>
        {ahead && !canEdit && <span style={{ fontSize: 12, color: "var(--w3)" }}>{shortDate(marks.kp_date, l)}</span>}
        {canEdit && <DatePick value={marks.kp_date} label={`${t.kp} · ${t.date}`} onChange={(d) => onSave({ kp_date: d })} />}
      </div>
      {canEdit && marks.kp_date && marks.kp_date <= today && (
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={chipS(marks.kp_result === "passed")} onClick={() => onSave({ kp_result: marks.kp_result === "passed" ? "" : "passed" })}>✓ {t.passed}</button>
          <button type="button" style={chipS(marks.kp_result === "failed")} onClick={() => onSave({ kp_result: marks.kp_result === "failed" ? "" : "failed" })}>↻ {t.failed}</button>
        </div>
      )}
      {(marks.kp_result === "passed" || marks.urkunde) && (
        <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <Mark icon="papers" name={t.urkunde} date={marks.urkunde} canEdit={canEdit} onSet={(d) => onSave({ urkunde: d })} />
        </div>
      )}
    </div>
  );
}

export function KeyPapers({ onDocs }: { onDocs?: () => void }) {
  const t = T[useL()];
  return (
    <div className="bw-card">
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, marginBottom: 12 }}>{t.papers}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {([["visa", t.pass], ["papers", t.cv], ["contract", t.vertrag]] as const).map(([ic, n]) => (
          <button key={n} type="button" onClick={onDocs} style={{ display: "grid", justifyItems: "center", gap: 8, padding: "14px 4px", minWidth: 0, overflowWrap: "anywhere", textAlign: "center", borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w2)", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>
            <span style={{ color: "var(--gold)" }}><WayIcon k={ic} size={22} /></span>{n}
          </button>
        ))}
      </div>
    </div>
  );
}
