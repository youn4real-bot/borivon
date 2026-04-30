"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { isValidEmail } from "@/lib/utils";
import {
  TURNSTILE_SITE_KEY as SITE_KEY,
  TURNSTILE_CB_OK, TURNSTILE_CB_EXP, TURNSTILE_CB_ERR,
  registerTurnstile,
} from "@/lib/turnstile";

type Mode = "login" | "register";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function PortalPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [mode, setMode]                       = useState<Mode>("login");
  const [firstName, setFirstName]             = useState("");
  const [lastName, setLastName]               = useState("");
  const [email, setEmail]                     = useState("");
  const [password, setPassword]               = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword]       = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");
  const [checkEmail, setCheckEmail]           = useState(false);
  const [consent, setConsent]                 = useState(false);
  const [dataConsent, setDataConsent]         = useState(false);
  const [turnstileToken, setTurnstileToken]   = useState<string | null>(null);

  useEffect(() => {
    return registerTurnstile({
      onOk:  (token) => setTurnstileToken(token),
      onExp: () => setTurnstileToken(null),
      onErr: () => setTurnstileToken(null),
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!isValidEmail(email))  { setError(t.pErrEmail); return; }
    if (password.length < 6)   { setError(t.pErrPassword); return; }
    if (mode === "register") {
      if (!firstName.trim())   { setError(t.pErrFirstName); return; }
      if (!lastName.trim())    { setError(t.pErrLastName); return; }
      if (password !== confirmPassword) { setError(t.pErrPasswordMatch); return; }
      if (!consent)             { setError(t.pConsentRequired); return; }
      if (!dataConsent)         { setError(t.pDataConsentRequired); return; }
      if (SITE_KEY && !turnstileToken) {
        setError(
          lang === "de" ? "Bitte schließen Sie die Cloudflare-Überprüfung ab." :
          lang === "en" ? "Please complete the Cloudflare verification." :
          "Veuillez compléter la vérification Cloudflare avant de continuer."
        );
        return;
      }
    }
    setLoading(true);

    if (mode === "register" && SITE_KEY && turnstileToken) {
      try {
        const res = await fetch("/api/portal/verify-turnstile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(
            lang === "de" ? "Sicherheitsprüfung fehlgeschlagen. Bitte erneut versuchen." :
            lang === "en" ? "Security check failed. Please try again." :
            "Vérification de sécurité échouée. Veuillez réessayer."
          );
          setTurnstileToken(null);
          setLoading(false);
          return;
        }
      } catch {
        setError(
          lang === "de" ? "Netzwerkfehler bei der Überprüfung. Bitte erneut versuchen." :
          lang === "en" ? "Network error during verification. Please try again." :
          "Erreur réseau lors de la vérification. Veuillez réessayer."
        );
        setLoading(false);
        return;
      }
    }

    if (mode === "register") {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: {
          data: { first_name: firstName.trim(), last_name: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` },
          emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
        },
      });
      if (err) {
        setError(err.message === "User already registered" ? t.pErrExists : err.message);
        setLoading(false); return;
      }
      setCheckEmail(true); setLoading(false); return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (err) {
      const m = err.message;
      setError(m === "Invalid login credentials" ? t.pErrWrong : m === "Email not confirmed" ? t.pErrNotConfirmed : m);
      setLoading(false); return;
    }
    router.replace("/portal/dashboard");
  }

  function switchMode(m: Mode) {
    setMode(m); setError(""); setCheckEmail(false);
    setFirstName(""); setLastName(""); setPassword(""); setConfirmPassword("");
    setShowPassword(false); setShowConfirm(false);
    setConsent(false); setDataConsent(false);
    setTurnstileToken(null);
  }

  // ── Shared styles — match the CV-builder visual language: filled bg2,
  // borderless (transparent border that turns gold on focus), 12px radius,
  // 15px text. Padding/font line up with the rest of the site's inputs.
  const fieldStyle: React.CSSProperties = {
    background: "var(--bg2)",
    border: "1px solid transparent",
    color: "var(--w)",
    borderRadius: "12px",
    width: "100%",
    padding: "14px 16px",
    fontSize: "15px",
    fontWeight: 500,
    outline: "none",
    transition: "border-color 160ms",
  };

  if (checkEmail) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
        <div className="w-full max-w-[400px] text-center">
          <div className="mx-auto mb-6 w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </div>
          <h1 className="text-[20px] font-semibold mb-2" style={{ color: "var(--w)" }}>{t.pCheckEmail}</h1>
          <p className="text-[13.5px] leading-relaxed mb-8" style={{ color: "var(--w3)" }}>
            {t.pCheckEmailDesc.replace("{email}", email)}
          </p>
          <button onClick={() => switchMode("login")}
            className="text-[13px] underline underline-offset-4 transition-opacity hover:opacity-70"
            style={{ color: "var(--gold)" }}>{t.pBackLogin}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)", paddingBottom: "3rem" }}>
      <div className="w-full max-w-[420px]">

        {/* Card — same DNA as CV-builder section cards: borderless, 20px
            radius, soft shadow. The deeper modal-style shadow is reserved
            for popups; the standalone login card uses the lighter variant. */}
        <div className="px-8 py-10"
          style={{ background: "var(--card)", border: "none", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)" }}>

          {/* Logo */}
          <div className="text-center mb-8">
            <span className="font-[family-name:var(--font-dm-serif)] italic"
              style={{ fontSize: "2rem", color: "var(--w)", letterSpacing: "-0.01em" }}>
              Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
            </span>
          </div>

          {/* Title */}
          <h1 className="text-center text-[18px] font-semibold mb-6 tracking-tight" style={{ color: "var(--w)" }}>
            {mode === "login" ? t.pBtnLogin : t.pBtnSignup}
          </h1>

          <form onSubmit={handleSubmit} noValidate className="space-y-3">

            {/* Name fields — register only */}
            {mode === "register" && (
              <>
                <input
                  type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder={t.pFirstName} autoComplete="given-name"
                  style={fieldStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
                />
                <input
                  type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder={t.pLastName} autoComplete="family-name"
                  style={fieldStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
                />
              </>
            )}

            {/* Email */}
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={t.phEmail} autoComplete="email"
              style={fieldStyle}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
              onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
            />

            {/* Password */}
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === "register" ? t.pPasswordHint : t.pPassword}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                style={{ ...fieldStyle, paddingRight: "44px" }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                <EyeIcon open={showPassword} />
              </button>
            </div>

            {/* Confirm password — register only */}
            {mode === "register" && (
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t.pConfirmPassword} autoComplete="new-password"
                  style={{ ...fieldStyle, paddingRight: "44px" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)}
                  style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            )}

            {/* Turnstile — register only */}
            {SITE_KEY && mode === "register" && (
              <div className="flex justify-center pt-1">
                <div
                  className="cf-turnstile"
                  data-sitekey={SITE_KEY}
                  data-theme="auto"
                  data-appearance="interaction-only"
                  data-size="normal"
                  data-callback={TURNSTILE_CB_OK}
                  data-expired-callback={TURNSTILE_CB_EXP}
                  data-error-callback={TURNSTILE_CB_ERR}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-[12.5px] px-3 py-2.5 rounded-xl"
                style={{ background: "rgba(224,82,82,0.08)", color: "#e05252", border: "1px solid rgba(224,82,82,0.2)" }}>
                {error}
              </p>
            )}

            {/* CTA — matches CV-builder primary buttons: 12px radius, soft
                gold-tinted dropshadow, gentle lift on hover. */}
            <button type="submit" disabled={loading}
              className="w-full py-4 text-[14px] font-semibold tracking-wide transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
              style={{
                background: "var(--gold)",
                color: "#131312",
                marginTop: "4px",
                borderRadius: "12px",
                boxShadow: "0 4px 14px rgba(212,175,55,0.25)",
                border: "none",
              }}>
              {loading ? "…" : mode === "login" ? t.pBtnLogin : t.pBtnSignup}
            </button>
          </form>

          {/* Consent — register only. Two separate mandatory boxes:
              1) Terms & conditions       2) Data processing & sharing */}
          {mode === "register" && (
            <div className="mt-4 flex flex-col gap-2.5">
              {/* Box 1 — Terms */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <div className="relative flex-shrink-0 mt-0.5">
                  <input type="checkbox" checked={consent}
                    onChange={e => { setConsent(e.target.checked); if (e.target.checked) setError(""); }}
                    className="sr-only" />
                  <div className="w-4 h-4 rounded-[4px] flex items-center justify-center transition-all"
                    style={{ background: consent ? "var(--gold)" : "transparent", border: `1.5px solid ${consent ? "var(--gold)" : "var(--border2)"}` }}>
                    {consent && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                </div>
                <span className="text-[11.5px] leading-relaxed" style={{ color: "var(--w3)" }}>
                  {t.pConsentPre}{" "}
                  <a href="/portal/terms" target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="underline underline-offset-2 hover:opacity-80"
                    style={{ color: "var(--gold)" }}>{t.pConsentLink}</a>
                  {" "}{t.pConsentPost}
                </span>
              </label>

              {/* Box 2 — Mandatory data-processing & third-party sharing */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <div className="relative flex-shrink-0 mt-0.5">
                  <input type="checkbox" checked={dataConsent}
                    onChange={e => { setDataConsent(e.target.checked); if (e.target.checked) setError(""); }}
                    className="sr-only" />
                  <div className="w-4 h-4 rounded-[4px] flex items-center justify-center transition-all"
                    style={{ background: dataConsent ? "var(--gold)" : "transparent", border: `1.5px solid ${dataConsent ? "var(--gold)" : "var(--border2)"}` }}>
                    {dataConsent && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                </div>
                <span className="text-[11.5px] leading-relaxed" style={{ color: "var(--w3)" }}>
                  {t.pDataConsent}
                </span>
              </label>
            </div>
          )}

          {/* Switch mode */}
          <p className="text-center text-[13px] mt-6" style={{ color: "var(--w3)" }}>
            {mode === "login" ? (
              <>
                {lang === "de" ? "Noch kein Konto?" : lang === "en" ? "Don't have an account yet?" : "Pas encore de compte ?"}{" "}
                <button onClick={() => switchMode("register")}
                  className="font-semibold underline-offset-2 hover:opacity-80 transition-opacity"
                  style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}>
                  {t.pBtnSignup}
                </button>
              </>
            ) : (
              <>
                {lang === "de" ? "Bereits ein Konto?" : lang === "en" ? "Already have an account?" : "Déjà un compte ?"}{" "}
                <button onClick={() => switchMode("login")}
                  className="font-semibold underline-offset-2 hover:opacity-80 transition-opacity"
                  style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}>
                  {t.pBtnLogin}
                </button>
              </>
            )}
          </p>

        </div>
      </div>
    </main>
  );
}
