"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { FxShell, useFxLang, Arrow } from "@/components/fx/Shell";
import { fxT, fill } from "@/components/fx/i18n";

type Prefill = { email: string; salutation: string; lastName: string; facility: string; existing: boolean };

/**
 * The gift (founder 2026-11-10): the link on the last page of the Fahrplan lands here. Big welcome,
 * three plain promises, then the facility's name, a password and TWO empty boxes (terms, AVV) the
 * person ticks themselves → their own space in the Borivon portal. The free scope's numbers live in
 * the terms (§ 3), not in this page's words.
 */
export function StartView() {
  const { lang, setLang, ready } = useFxLang();
  const t = fxT(lang);
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id") ?? "", tok = sp.get("t") ?? "";
  const [pre, setPre] = useState<Prefill | null>(null);
  const [bad, setBad] = useState(false);
  const [name, setName] = useState(""), [pw, setPw] = useState("");
  const [terms, setTerms] = useState(false), [avv, setAvv] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");

  useEffect(() => {
    if (!id || !tok) { setBad(true); return; }
    fetch(`/api/einrichtung/start?id=${encodeURIComponent(id)}&t=${encodeURIComponent(tok)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Prefill) => { setPre(j); setName(j.facility || ""); })
      .catch(() => setBad(true));
  }, [id, tok]);

  const title = (s: string) => (lang === "de" ? (s === "frau" ? "Frau" : s === "herr" ? "Herr" : "") : lang === "fr" ? (s === "frau" ? "Madame" : s === "herr" ? "Monsieur" : "") : (s === "frau" ? "Ms" : s === "herr" ? "Mr" : ""));
  const who = pre?.lastName ? `, ${[title(pre.salutation), pre.lastName].filter(Boolean).join(" ")}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pre) return;
    if (!name.trim()) return setErr(t.errName);
    if (pw.length < 8) return setErr(t.errPw);
    if (!terms || !avv) return setErr(t.errTerms);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/einrichtung/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, t: tok, name: name.trim(), password: pw, terms, avv }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        // signed in with the password they just chose → their facility in the portal
        const { error } = await supabase.auth.signInWithPassword({ email: pre.email, password: pw });
        router.replace(error ? "/portal" : "/portal/admin");
        return;
      }
      if (j.error === "exists" || j.error === "account_exists") setPre({ ...pre, existing: true });
      else setErr(r.status === 429 ? t.errMany : j.error === "terms_required" ? t.errTerms : j.error === "password_short" ? t.errPw : t.errGeneric);
    } catch { setErr(t.errGeneric); }
    setBusy(false);
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
      <p className="fx-lede" style={{ margin: "18px auto 30px" }}>{fill(t.existsP, { email: pre.email })}</p>
      <a className="fx-btn" href="/portal">{t.toPortal}<Arrow /></a>
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
            {[t.f1, t.f2, t.f3, t.f4, t.f5, t.f6].map((x, i) => (
              <li key={i} style={{ display: "flex", gap: 18, alignItems: "baseline", padding: "16px 2px" }}>
                <span style={{ font: "500 1.05rem/1 var(--serif)", color: "var(--gold-d)", minWidth: 22 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 15.5 }}>{x}</span>
              </li>
            ))}
          </ol>
          {/* a picture of what opens after the click (founder 2026-11-11: visuals, real faces) */}
          <div className="fx-pic fx-rise d3" aria-hidden="true">
            {[{ n: 1, nm: "Amina E.", w: 92, ok: true }, { n: 3, nm: "Youssef B.", w: 70, ok: false }, { n: 2, nm: "Salma O.", w: 48, ok: false }].map((r, i) => (
              <div className="r" key={r.n}>
                <img src={`/pflege/assets/pf/av-${r.n}.webp`} alt="" width={240} height={240} loading="lazy" />
                <div><b>{r.nm}</b><i><s style={{ width: `${r.w}%` }} /></i></div>
                <em className={r.ok ? "ok" : i === 2 ? "new" : ""}>{t.picSt.split("|")[i]}</em>
              </div>
            ))}
            <small>{t.picCap}</small>
          </div>
        </div>

        <form className="fx-card fx-rise d2" onSubmit={submit} noValidate>
          <p className="fx-lbl" style={{ marginBottom: 22 }}>{t.yourFacility}</p>
          <label className="fx-field"><span>{t.facName}</span>
            <input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" required maxLength={120} />
          </label>
          <label className="fx-field"><span>{t.accessFor}</span>
            <input className="fx-input" value={pre.email} readOnly autoComplete="username" />
          </label>
          <label className="fx-field"><span>{t.pwLabel}</span>
            <input className="fx-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required />
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
