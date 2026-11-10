"use client";

import { useEffect, useState } from "react";
import { FxShell, useFxLang, Arrow } from "@/components/fx/Shell";
import { fxT } from "@/components/fx/i18n";

/** Sign in without a password: email → one-time link. Same answer whether or not the email exists. */
export default function LoginPage() {
  const { lang, setLang, ready } = useFxLang();
  const t = fxT(lang);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [err, setErr] = useState("");
  const [e0, setE0] = useState<string | null>(null);
  useEffect(() => setE0(new URLSearchParams(window.location.search).get("e")), []);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr(t.errEmail);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/einrichtung/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), lang }) });
      if (r.ok) setSent(true);
      else setErr(r.status === 429 ? t.errMany : r.status === 400 ? t.errEmail : t.errGeneric);
    } catch { setErr(t.errGeneric); }
    setBusy(false);
  }

  return (
    <FxShell lang={lang} setLang={setLang} ready={ready}>
      <div className="c narrow" style={{ maxWidth: 520, paddingTop: "6vh" }}>
        {sent ? (
          <>
            <h1 className="fx-h2 fx-rise">{t.sentH}</h1>
            <p className="fx-lede fx-rise d1">{t.sentP}</p>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className="fx-h1 fx-rise" style={{ fontSize: "clamp(2.2rem,1.6rem + 2.4vw,3.2rem)" }}>{t.loginH}</h1>
            <p className="fx-lede fx-rise d1" style={{ marginBottom: 30 }}>{t.loginP}</p>
            {e0 === "link" && <p className="fx-err">{t.linkBad}</p>}
            <label className="fx-field fx-rise d2"><span>{t.email}</span>
              <input className="fx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </label>
            {err && <p className="fx-err" role="alert">{err}</p>}
            <button className="fx-btn fx-rise d3" type="submit" disabled={busy} style={{ width: "100%" }}>{t.sendLogin}<Arrow /></button>
            <p className="fx-small" style={{ marginTop: 26 }}>{t.noAccess}</p>
          </form>
        )}
      </div>
    </FxShell>
  );
}
