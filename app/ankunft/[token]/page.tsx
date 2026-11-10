"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FxShell, useFxLang } from "@/components/fx/Shell";
import { Plan, fmtDate } from "@/components/fx/Plan";
import { fxT, fill } from "@/components/fx/i18n";
import type { StepId } from "@/lib/facility/steps";

type P = { first_name: string; sample: boolean; arrival: string; start: string; plz: string; city: string; steps: Record<string, string>; facility: string };

/**
 * The nurse's own plan (a private link from her facility): the same steps and places, in German,
 * French or English, and she ticks steps herself. No login, no account.
 */
export default function ArrivalPage() {
  const { token } = useParams<{ token: string }>();
  const { lang, setLang, ready } = useFxLang();
  const t = fxT(lang);
  const [p, setP] = useState<P | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/ankunft/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setP)
      .catch(() => setMissing(true));
  }, [token]);

  async function toggle(id: StepId, done: boolean) {
    if (!p) return;
    const steps = { ...p.steps };
    if (done) steps[id] = new Date().toISOString(); else delete steps[id];
    setP({ ...p, steps });
    const r = await fetch(`/api/ankunft/${encodeURIComponent(token)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: id, done }) }).catch(() => null);
    if (r?.ok) { const j = await r.json().catch(() => null); if (j?.steps) setP((x) => (x ? { ...x, steps: j.steps } : x)); }
  }

  return (
    <FxShell lang={lang} setLang={setLang} ready={ready && (!!p || missing)}>
      {missing ? (
        <div className="c narrow" style={{ textAlign: "center", paddingTop: "8vh" }}>
          <h1 className="fx-h2">{t.notFoundH}</h1>
          <p className="fx-lede" style={{ margin: "16px auto 0" }}>{t.notFoundP}</p>
        </div>
      ) : p && (
        <div className="c">
          <p className="fx-lbl fx-rise">{t.yourSteps}</p>
          <h1 className="fx-h1 fx-rise d1">{fill(t.welcome, { name: p.first_name })}</h1>
          <p className="fx-lede fx-rise d2">
            {fill(t.welcomeP, { city: p.city || p.plz, facility: p.facility })}
            {p.start && <> {t.firstDay}: <b style={{ fontWeight: 500 }}>{fmtDate(p.start, lang, true)}</b>.</>}
          </p>
          <Plan lang={lang} arrival={p.arrival} steps={p.steps} placesUrl={`/api/einrichtung/places?s=${encodeURIComponent(token)}`} onToggle={toggle} voice="nurse" />
        </div>
      )}
    </FxShell>
  );
}
