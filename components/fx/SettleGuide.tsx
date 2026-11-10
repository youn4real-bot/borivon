"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/facility/steps";
import { SETTLE, SETTLE_T, phaseDate, probationEnd } from "@/lib/facility/settle";
import { fmtDate } from "./Plan";

const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>;

/** The first six months: Tag 1 to the end of probation, ticked by both sides (app/api/portal/settle). */
export function SettleGuide({ lang, token, userId, start, nurse }: { lang: Lang; token: string; userId?: string; start: string; nurse: boolean }) {
  const t = SETTLE_T[lang] ?? SETTLE_T.de;
  const [steps, setSteps] = useState<Record<string, string> | null>(null);
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/settle${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setSteps(j.steps || {}); }).catch(() => {});
  }, [token, q]);

  async function toggle(id: string, done: boolean) {
    if (!steps) return;
    const next = { ...steps };
    if (done) next[id] = new Date().toISOString(); else delete next[id];
    setSteps(next);
    await fetch("/api/portal/settle", {
      method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(userId ? { userId } : {}), step: id, done }),
    }).catch(() => null);
  }
  if (!steps) return null;

  const today = new Date().toISOString().slice(0, 10);
  // the phase she is in now (only once the first working day is known and has come)
  const nowIdx = start && start <= today ? SETTLE.reduce((n, b, i) => (phaseDate(start, b.at) <= today ? i : n), 0) : -1;
  const all = SETTLE.flatMap((b) => b.items);
  const done = all.filter((i) => steps[i.id]).length;
  const end = probationEnd(start);

  return (
    <section style={{ marginTop: 64 }}>
      <h2 className="fx-h2">{t.h}</h2>
      <p className="fx-lede" style={{ marginTop: 12 }}>{nurse ? t.pNurse : t.pFac}</p>
      <div className="fx-six">
        {SETTLE.map((b, i) => {
          const d = phaseDate(start, b.at);
          return (
            <div key={b.id} className={`fx-ph${i === nowIdx ? " now" : ""}${nowIdx > i ? " past" : ""}`}>
              <div>
                <div className="pw">{b.when[lang]}</div>
                {d && <div className="pd">{i === 0 ? fmtDate(d, lang, true) : t.from.replace("{d}", fmtDate(d, lang))}</div>}
              </div>
              <ul>
                {b.items.map((it) => {
                  const on = !!steps[it.id];
                  const text = (nurse ? it.nurse : it.fac)[lang];
                  return (
                    <li key={it.id}>
                      <button type="button" className="fx-chk" aria-pressed={on} onClick={() => toggle(it.id, !on)}>
                        <span className="bx">{on && <Check />}</span><span className="tx">{text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="fx-end">
        <span>{t.of.replace("{a}", String(done)).replace("{b}", String(all.length))}</span>
        {end && <b>{t.end.replace("{d}", fmtDate(end, lang, true))}</b>}
      </p>
    </section>
  );
}
