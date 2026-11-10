"use client";

import "./fx.css";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import type { Lang, StepId } from "@/lib/facility/steps";
import { Plan, fmtDate } from "./Plan";
import { fxT } from "./i18n";
import { VisaGuide } from "./VisaGuide";
import { MoveGuide } from "./MoveGuide";

type Arr = { arrival: string; start: string; plz: string; city: string; steps: Record<string, string> };

/**
 * The arrival plan inside the portal (founder 2026-11-10: "the nurse lands in this city and the system
 * shows the closest places"). The nurse (no userId) sees her own; an admin passes the nurse's userId.
 * Same plan, same ticks, both sides (app/api/portal/arrival).
 */
export function ArrivalPanel({ userId, name }: { userId?: string; name?: string }) {
  const { lang: l } = useLang();
  const lang = (["de", "en", "fr"].includes(l) ? l : "de") as Lang;
  const t = fxT(lang);
  const nurse = !userId;
  const [token, setToken] = useState("");
  const [a, setA] = useState<Arr | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ arrival: "", start: "", plz: "", city: "" });
  const [err, setErr] = useState("");
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token ?? "";
    setToken(tok);
    if (!tok) return;
    const r = await fetch(`/api/portal/arrival${q}`, { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as Arr;
      setA(j);
      setF({ arrival: j.arrival, start: j.start, plz: j.plz, city: j.city });
      if (!j.plz) setEditing(true);
    }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.plz && !/^\d{5}$/.test(f.plz)) return setErr(t.errPlz);
    setErr("");
    const r = await fetch("/api/portal/arrival", {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(userId ? { userId } : {}), ...f }),
    }).catch(() => null);
    if (r?.ok) { setA(await r.json()); setEditing(false); } else setErr(t.errGeneric);
  }

  async function toggle(id: StepId, done: boolean) {
    if (!a) return;
    const steps = { ...a.steps };
    if (done) steps[id] = new Date().toISOString(); else delete steps[id];
    setA({ ...a, steps });
    const r = await fetch("/api/portal/arrival", {
      method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(userId ? { userId } : {}), step: id, done }),
    }).catch(() => null);
    if (r?.ok) { const j = await r.json(); setA((x) => (x ? { ...x, steps: j.steps } : x)); }
  }

  const where = a ? [a.plz, a.city].filter(Boolean).join(" ") : "";

  return (
    <div className="fx" style={{ minHeight: "auto", background: "transparent" }}>
      <div className="c" style={{ paddingTop: 8, paddingBottom: 72 }}>
        <p className="fx-lbl">{nurse ? t.yourSteps : t.arrAdminH}</p>
        <h1 className="fx-h1" style={{ fontSize: "clamp(2.1rem,1.5rem + 2.4vw,3.4rem)" }}>{nurse ? t.arrNurseH : (name || t.arrAdminH)}</h1>
        <p className="fx-lede">{nurse ? t.arrNurseP : t.arrAdminP}</p>
        {/* the visa first, then the first weeks (founder 2026-11-10: the journey in order) */}
        {token && <VisaGuide lang={lang} token={token} userId={userId} />}
        {token && <MoveGuide lang={lang} token={token} userId={userId} />}
        {/* the first weeks: where she lives (asked here, in order), then the plan with the offices nearby */}
        {a && <h2 className="fx-h2" style={{ marginTop: 56 }}>{t.planH}</h2>}
        {a && !editing && (
          <p className="fx-mute" style={{ margin: "14px 0 0", display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "baseline" }}>
            <span>{[a.arrival && `${t.arrival} ${fmtDate(a.arrival, lang, true)}`, a.start && `${t.firstDay} ${fmtDate(a.start, lang, true)}`, where].filter(Boolean).join(" · ")}</span>
            <button className="fx-link" onClick={() => setEditing(true)}>{t.arrDetails}</button>
          </p>
        )}
        {a && editing && (
          <form className="fx-card" onSubmit={save} noValidate style={{ marginTop: 26, maxWidth: 640 }}>
            <p className="fx-small" style={{ margin: "0 0 16px" }}>{nurse ? t.arrAskNurse : t.arrAskAdmin}</p>
            <div className="fx-grid2">
              <label className="fx-field"><span>{t.arrivalDate}</span><input className="fx-input" type="date" value={f.arrival} onChange={(e) => setF({ ...f, arrival: e.target.value })} /></label>
              <label className="fx-field"><span>{t.startDate}</span><input className="fx-input" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            </div>
            <div className="fx-grid3">
              <label className="fx-field"><span>{t.plz}</span><input className="fx-input" value={f.plz} inputMode="numeric" onChange={(e) => setF({ ...f, plz: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></label>
              <label className="fx-field"><span>{t.city}</span><input className="fx-input" value={f.city} maxLength={80} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
            </div>
            {err && <p className="fx-err" role="alert">{err}</p>}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="fx-btn" type="submit">{t.save}</button>
              {a.plz && <button className="fx-btn ghost" type="button" onClick={() => setEditing(false)}>{t.cancel}</button>}
            </div>
          </form>
        )}
        {a && a.plz && (
          <Plan lang={lang} arrival={a.arrival} steps={a.steps} authToken={token} voice={nurse ? "nurse" : "facility"}
            placesUrl={`/api/einrichtung/places?plz=${a.plz}&city=${encodeURIComponent(a.city)}`} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}
