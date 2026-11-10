"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FxShell, useFxLang, Arrow } from "@/components/fx/Shell";
import { fxT, fill } from "@/components/fx/i18n";

type Prefill = { email: string; salutation: string; lastName: string; facility: string; kind: string; existing: boolean };
type Kind = "care_home" | "hospital" | "home_care";

/**
 * The gift (founder 2026-11-10): the link on the last page of the Fahrplan lands here. Big welcome,
 * three plain promises, then the facility's details and TWO empty boxes (terms, AVV) the person ticks
 * themselves. The free scope's numbers live in the terms (§ 3), not in this page's words.
 */
export function StartView() {
  const { lang, setLang, ready } = useFxLang();
  const t = fxT(lang);
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id") ?? "", tok = sp.get("t") ?? "";
  const [pre, setPre] = useState<Prefill | null>(null);
  const [bad, setBad] = useState(false);
  const [f, setF] = useState({ name: "", street: "", plz: "", city: "", kind: "care_home" as Kind });
  const [terms, setTerms] = useState(false), [avv, setAvv] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [sent, setSent] = useState(false);

  useEffect(() => {
    if (!id || !tok) { setBad(true); return; }
    fetch(`/api/einrichtung/start?id=${encodeURIComponent(id)}&t=${encodeURIComponent(tok)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Prefill) => {
        setPre(j);
        setF((x) => ({ ...x, name: j.facility || "", kind: (["care_home", "hospital", "home_care"].includes(j.kind) ? j.kind : "care_home") as Kind }));
      })
      .catch(() => setBad(true));
  }, [id, tok]);

  const who = pre?.lastName
    ? (lang === "de" ? `, ${pre.salutation === "frau" ? "Frau" : pre.salutation === "herr" ? "Herr" : ""} ${pre.lastName}`.replace(",  ", ", ")
      : lang === "fr" ? `, ${pre.salutation === "frau" ? "Madame" : pre.salutation === "herr" ? "Monsieur" : ""} ${pre.lastName}`.replace(",  ", ", ")
      : `, ${pre.salutation === "frau" ? "Ms" : pre.salutation === "herr" ? "Mr" : ""} ${pre.lastName}`.replace(",  ", ", "))
    : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!f.name.trim()) return setErr(t.errName);
    if (!/^\d{5}$/.test(f.plz.trim())) return setErr(t.errPlz);
    if (!terms || !avv) return setErr(t.errTerms);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/einrichtung/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, t: tok, ...f, plz: f.plz.trim(), terms, avv }),
      });
      if (r.ok) { router.replace("/einrichtung"); return; }
      const j = await r.json().catch(() => ({}));
      if (j.error === "exists") setPre((p) => (p ? { ...p, existing: true } : p));
      else setErr(r.status === 429 ? t.errMany : j.error === "terms_required" ? t.errTerms : j.error === "plz_required" ? t.errPlz : t.errGeneric);
    } catch { setErr(t.errGeneric); }
    setBusy(false);
  }

  async function sendLogin() {
    if (!pre || busy) return;
    setBusy(true);
    await fetch("/api/einrichtung/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: pre.email, lang }) }).catch(() => {});
    setBusy(false); setSent(true);
  }

  const shell = (body: React.ReactNode) => <FxShell lang={lang} setLang={setLang} ready={ready && (bad || !!pre)}>{body}</FxShell>;

  if (bad) return shell(
    <div className="c narrow" style={{ textAlign: "center", paddingTop: "8vh" }}>
      <h1 className="fx-h2">{t.invalidH}</h1>
      <p className="fx-lede" style={{ margin: "18px auto 30px" }}>{t.invalidP}</p>
      <a className="fx-btn" href="/fahrplan">{t.getPlan}<Arrow /></a>
    </div>,
  );
  if (!pre) return shell(null);

  if (pre.existing) return shell(
    <div className="c narrow" style={{ textAlign: "center", paddingTop: "8vh" }}>
      <h1 className="fx-h2">{t.existsH}</h1>
      {sent ? <p className="fx-ok" style={{ display: "inline-block", marginTop: 24 }}>{t.sentP}</p> : (
        <>
          <p className="fx-lede" style={{ margin: "18px auto 30px" }}>{fill(t.existsP, { email: pre.email })}</p>
          <button className="fx-btn" onClick={sendLogin} disabled={busy}>{t.sendLink}<Arrow /></button>
        </>
      )}
    </div>,
  );

  return shell(
    <div className="c">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,.9fr)", gap: "clamp(32px,5vw,80px)", alignItems: "start" }} className="fx-startgrid">
        <div style={{ paddingTop: "clamp(0px,2vw,24px)" }}>
          <p className="fx-lbl fx-rise">{t.gift}</p>
          <h1 className="fx-h1 fx-rise d1">{fill(t.startH, { name: who })}</h1>
          <p className="fx-lede fx-rise d2">{t.startP}</p>
          <ol className="fx-rows fx-rise d3" style={{ marginTop: 40, maxWidth: 520 }}>
            {[t.f1, t.f2, t.f3].map((x, i) => (
              <li key={i} style={{ display: "flex", gap: 18, alignItems: "baseline", padding: "16px 2px" }}>
                <span style={{ font: "500 1.05rem/1 var(--serif)", color: "var(--gold-d)", minWidth: 22 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 15.5 }}>{x}</span>
              </li>
            ))}
          </ol>
        </div>

        <form className="fx-card fx-rise d2" onSubmit={submit} noValidate>
          <p className="fx-lbl" style={{ marginBottom: 22 }}>{t.yourFacility}</p>
          <label className="fx-field"><span>{t.facName}</span>
            <input className="fx-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="organization" required maxLength={120} />
          </label>
          <div className="fx-field">
            <div className="fx-seg" role="group" aria-label={t.yourFacility}>
              {(["care_home", "hospital", "home_care"] as Kind[]).map((k) => (
                <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t.kinds[k]}</button>
              ))}
            </div>
          </div>
          <label className="fx-field"><span>{t.street}</span>
            <input className="fx-input" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} autoComplete="street-address" maxLength={120} />
          </label>
          <div className="fx-grid3">
            <label className="fx-field"><span>{t.plz}</span>
              <input className="fx-input" value={f.plz} onChange={(e) => setF({ ...f, plz: e.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" autoComplete="postal-code" required />
            </label>
            <label className="fx-field"><span>{t.city}</span>
              <input className="fx-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} autoComplete="address-level2" maxLength={80} />
            </label>
          </div>
          <label className="fx-field"><span>{t.accessFor}</span>
            <input className="fx-input" value={pre.email} readOnly />
          </label>
          <div style={{ margin: "26px 0 22px", paddingTop: 22, borderTop: "1px solid var(--line)" }}>
            <label className="fx-check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>{t.acceptTerms.split("{link}")[0]}<a href="/einrichtung/nutzungsbedingungen" target="_blank" rel="noopener">{t.termsLink}</a>{t.acceptTerms.split("{link}")[1]}</span>
            </label>
            <label className="fx-check">
              <input type="checkbox" checked={avv} onChange={(e) => setAvv(e.target.checked)} />
              <span>{t.acceptAvv.split("{link}")[0]}<a href="/einrichtung/avv" target="_blank" rel="noopener">{t.avvLink}</a>{t.acceptAvv.split("{link}")[1]}</span>
            </label>
          </div>
          {err && <p className="fx-err" role="alert">{err}</p>}
          <button className="fx-btn" type="submit" disabled={busy} style={{ width: "100%" }}>{busy ? t.opening : t.open}{!busy && <Arrow />}</button>
        </form>
      </div>
      <style>{"@media (max-width:860px){.fx-startgrid{grid-template-columns:1fr!important}}"}</style>
    </div>,
  );
}
