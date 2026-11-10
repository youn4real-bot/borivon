"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FxShell, useFxLang, Arrow } from "@/components/fx/Shell";
import { fxT } from "@/components/fx/i18n";

/**
 * The page behind every login / invite mail. One button that POSTs the token: mail scanners open
 * links with GET and never press buttons, so the one-time link survives until the person clicks.
 */
export default function SignInLinkPage() {
  const { lang, setLang, ready } = useFxLang();
  const t = fxT(lang);
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");

  async function go() {
    if (busy) return;
    setBusy(true); setErr("");
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    try {
      const r = await fetch("/api/einrichtung/login/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k }) });
      if (r.ok) { router.replace("/einrichtung"); return; }
      const j = await r.json().catch(() => ({}));
      setErr(j.error === "full" ? t.linkFull : j.error === "other" ? t.linkOther : r.status === 429 ? t.errMany : t.linkBad);
    } catch { setErr(t.errGeneric); }
    setBusy(false);
  }

  return (
    <FxShell lang={lang} setLang={setLang} ready={ready}>
      <div className="c narrow" style={{ maxWidth: 520, paddingTop: "8vh", textAlign: "center" }}>
        <h1 className="fx-h2 fx-rise">{t.signinH}</h1>
        <p className="fx-lede fx-rise d1" style={{ margin: "16px auto 30px" }}>{t.signinP}</p>
        {err ? (
          <>
            <p className="fx-err" role="alert" style={{ textAlign: "left" }}>{err}</p>
            <a className="fx-btn ghost" href="/einrichtung/login">{t.sendLogin}</a>
          </>
        ) : (
          <button className="fx-btn fx-rise d2" onClick={go} disabled={busy}>{t.signinB}<Arrow /></button>
        )}
      </div>
    </FxShell>
  );
}
