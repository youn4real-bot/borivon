"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/facility/steps";
import { VISA_STEPS, VISA_T } from "@/lib/facility/visa";
import { fmtDate } from "./Plan";

type V = { submitted: string; steps: Record<string, string> };
const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>;

/** The visa guide: the embassy's steps, who does what, the day count after handing in (app/api/portal/visa). */
export function VisaGuide({ lang, token, userId }: { lang: Lang; token: string; userId?: string }) {
  const t = VISA_T[lang] ?? VISA_T.de;
  const [v, setV] = useState<V | null>(null);
  const [date, setDate] = useState("");
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/visa${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setV(j); setDate(j.submitted || ""); } }).catch(() => {});
  }, [token, q]);

  async function toggle(id: string, done: boolean) {
    if (!v) return;
    const steps = { ...v.steps };
    if (done) steps[id] = new Date().toISOString(); else delete steps[id];
    setV({ ...v, steps });
    await fetch("/api/portal/visa", { method: "PATCH", headers: H, body: JSON.stringify({ ...(userId ? { userId } : {}), step: id, done }) }).catch(() => null);
  }
  async function saveDate(d: string) {
    setDate(d);
    const r = await fetch("/api/portal/visa", { method: "PUT", headers: H, body: JSON.stringify({ ...(userId ? { userId } : {}), submitted: d }) }).catch(() => null);
    if (r?.ok) setV(await r.json());
  }
  if (!v) return null;

  const day = v.submitted ? Math.max(0, Math.floor((Date.now() - Date.parse(v.submitted + "T12:00:00Z")) / 86400e3)) : null;
  const around = v.submitted ? new Date(Date.parse(v.submitted + "T12:00:00Z") + 21 * 86400e3).toISOString().slice(0, 10) : "";

  return (
    <section style={{ marginTop: 44 }}>
      <h2 className="fx-h2">{t.h}</h2>
      <p className="fx-lede" style={{ marginTop: 12 }}>{t.p}</p>
      <ol className="fx-steps" style={{ marginTop: 28, maxWidth: 760 }}>
        {VISA_STEPS.map((s, i) => {
          const done = !!v.steps[s.id];
          return (
            <li key={s.id} className={`fx-step${done ? " done" : ""}`}>
              <button type="button" className="fx-tick" aria-pressed={done} aria-label={s.title[lang]} onClick={() => toggle(s.id, !done)}>
                {done ? <Check /> : i + 1}
              </button>
              <div>
                <h3>{s.title[lang]}<span className="fx-tag" style={{ marginLeft: 10 }}>{t[s.who]}</span></h3>
                <p>{s.what[lang]}</p>
                {s.link && <p style={{ marginTop: 8 }}><a className="fx-link" href={s.link.href} target="_blank" rel="noopener noreferrer">{s.link.label[lang]} →</a></p>}
                {s.id === "submit" && (
                  <label className="fx-field" style={{ marginTop: 14, maxWidth: 260 }}>
                    <span>{t.submitted}</span>
                    <input className="fx-input" type="date" value={date} onChange={(e) => saveDate(e.target.value)} />
                  </label>
                )}
                {s.id === "wait" && day !== null && (
                  <div className="fx-place" style={{ gridTemplateColumns: "1fr" }}>
                    <span className="pn">{t.day.replace("{n}", String(day))}</span>
                    <span className="pa">{t.expect.replace("{d}", fmtDate(around, lang, true))} {t.exp}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="fx-small" style={{ margin: "4px 0 0", maxWidth: 760 }}>{t.src}</p>
    </section>
  );
}
