"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/facility/steps";
import { MOVE_STEPS, MOVE_T } from "@/lib/facility/move";

type M = { flight_from: string; flight_to: string; flight_date: string; pickup_by: string; steps: Record<string, string> };
const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>;

/** Wohnung + Anreise: the practical checklist, the flight and who picks her up (app/api/portal/move). */
export function MoveGuide({ lang, token, userId }: { lang: Lang; token: string; userId?: string }) {
  const t = MOVE_T[lang] ?? MOVE_T.de;
  const [m, setM] = useState<M | null>(null);
  const [f, setF] = useState({ flight_from: "", flight_to: "", flight_date: "", pickup_by: "" });
  const [saved, setSaved] = useState(false);
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/move${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: M | null) => { if (j) { setM(j); setF({ flight_from: j.flight_from, flight_to: j.flight_to, flight_date: j.flight_date, pickup_by: j.pickup_by }); } })
      .catch(() => {});
  }, [token, q]);

  async function toggle(id: string, done: boolean) {
    if (!m) return;
    const steps = { ...m.steps };
    if (done) steps[id] = new Date().toISOString(); else delete steps[id];
    setM({ ...m, steps });
    await fetch("/api/portal/move", { method: "PATCH", headers: H, body: JSON.stringify({ ...(userId ? { userId } : {}), step: id, done }) }).catch(() => null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/portal/move", { method: "PUT", headers: H, body: JSON.stringify({ ...(userId ? { userId } : {}), ...f }) }).catch(() => null);
    if (r?.ok) { setM(await r.json()); setSaved(true); setTimeout(() => setSaved(false), 2200); }
  }
  if (!m) return null;

  const group = (g: "home" | "trip") => MOVE_STEPS.filter((s) => s.group === g);
  const item = (s: (typeof MOVE_STEPS)[number], n: number) => {
    const done = !!m.steps[s.id];
    return (
      <li key={s.id} className={`fx-step${done ? " done" : ""}`}>
        <button type="button" className="fx-tick" aria-pressed={done} aria-label={s.title[lang]} onClick={() => toggle(s.id, !done)}>{done ? <Check /> : n}</button>
        <div><h3>{s.title[lang]}</h3><p>{s.what[lang]}</p></div>
      </li>
    );
  };

  return (
    <section style={{ marginTop: 56 }}>
      <h2 className="fx-h2">{t.h}</h2>
      <p className="fx-lede" style={{ marginTop: 12 }}>{t.p}</p>
      <div className="fx-plan" style={{ marginTop: 30 }}>
        <div>
          <p className="fx-lbl">{t.home}</p>
          <ol className="fx-steps">{group("home").map((s, i) => item(s, i + 1))}</ol>
        </div>
        <div>
          <p className="fx-lbl">{t.trip}</p>
          <ol className="fx-steps">{group("trip").map((s, i) => item(s, i + 1))}</ol>
          <form className="fx-card" onSubmit={save} noValidate style={{ marginTop: 6 }}>
            <div className="fx-grid2">
              <label className="fx-field"><span>{t.from}</span><input className="fx-input" value={f.flight_from} maxLength={60} placeholder="Casablanca" onChange={(e) => setF({ ...f, flight_from: e.target.value })} /></label>
              <label className="fx-field"><span>{t.to}</span><input className="fx-input" value={f.flight_to} maxLength={60} placeholder="München" onChange={(e) => setF({ ...f, flight_to: e.target.value })} /></label>
              <label className="fx-field"><span>{t.date}</span><input className="fx-input" type="date" value={f.flight_date} onChange={(e) => setF({ ...f, flight_date: e.target.value })} /></label>
              <label className="fx-field"><span>{t.by}</span><input className="fx-input" value={f.pickup_by} maxLength={80} onChange={(e) => setF({ ...f, pickup_by: e.target.value })} /></label>
            </div>
            <button className="fx-btn sm" type="submit">{saved ? t.saved : t.save}</button>
          </form>
        </div>
      </div>
    </section>
  );
}
