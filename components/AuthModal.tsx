"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "./LangContext";
import { isValidEmail } from "@/lib/utils";

type ModalMode = "login" | "register" | "forgot";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { t, lang } = useLang();

  const [mode, setMode]                       = useState<ModalMode>("login");
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
  const [resetSent, setResetSent]             = useState(false);
  const [consent, setConsent]                 = useState(false);
  const [dataConsent, setDataConsent]         = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open, onClose]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setMode("login");
      setFirstName(""); setLastName("");
      setEmail(""); setPassword(""); setConfirmPassword("");
      setShowPassword(false); setShowConfirm(false);
      setError(""); setCheckEmail(false); setResetSent(false);
      setConsent(false); setDataConsent(false); setLoading(false);
    }
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function reset(m: ModalMode) {
    setMode(m); setError(""); setCheckEmail(false); setResetSent(false);
    setFirstName(""); setLastName(""); setEmail(""); setPassword(""); setConfirmPassword("");
    setShowPassword(false); setShowConfirm(false);
    setConsent(false); setDataConsent(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (mode === "forgot") {
      if (!email.trim()) {
        setError(lang === "de" ? "Bitte geben Sie Ihre E-Mail-Adresse ein." : lang === "en" ? "Please enter your email address." : "Veuillez saisir votre adresse e-mail.");
        return;
      }
      setLoading(true);
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/portal/auth/callback` },
      );
      if (resetErr) { setError(resetErr.message); setLoading(false); return; }
      setResetSent(true); setLoading(false); return;
    }

    if (!isValidEmail(email))  { setError(t.pErrEmail); return; }
    if (password.length < 6)   { setError(t.pErrPassword); return; }

    if (mode === "register") {
      if (!firstName.trim()) { setError(t.pErrFirstName); return; }
      if (!lastName.trim())  { setError(t.pErrLastName); return; }
      if (password !== confirmPassword) { setError(t.pErrPasswordMatch); return; }
      if (!consent)     { setError(t.pConsentRequired); return; }
      if (!dataConsent) { setError(t.pDataConsentRequired); return; }
    }

    setLoading(true);

    if (mode === "register") {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: {
          data: {
            first_name: firstName.trim(), last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`,
          },
          emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
        },
      });
      if (err) {
        setError(err.message === "User already registered" ? t.pErrExists : err.message);
        setLoading(false); return;
      }
      setCheckEmail(true); setLoading(false); return;
    }

    // Login
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (err) {
      const m = err.message;
      setError(
        m === "Invalid login credentials" ? t.pErrWrong :
        m === "Email not confirmed"       ? t.pErrNotConfirmed : m
      );
      setLoading(false); return;
    }
    onClose();
    router.replace("/portal/dashboard");
  }

  if (!open) return null;

  // Field style — mirrors portal page exactly
  const fieldStyle: React.CSSProperties = {
    background: "var(--bg2)",
    border: "1px solid transparent",
    color: "var(--w)",
    borderRadius: "12px",
    width: "100%",
    padding: "13px 16px",
    fontSize: "14.5px",
    fontWeight: 500,
    outline: "none",
    transition: "border-color 160ms",
    fontFamily: "var(--font-dm-sans)",
  };

  const focusGold = (e: React.FocusEvent<HTMLInputElement>) => (e.currentTarget.style.borderColor = "var(--gold)");
  const blurReset = (e: React.FocusEvent<HTMLInputElement>) => (e.currentTarget.style.borderColor = "transparent");

  const weSentLabel = lang === "de" ? "Wir haben einen Bestätigungslink an" : lang === "en" ? "We sent a confirmation link to" : "Nous avons envoyé un lien de confirmation à";
  const weSentReset = lang === "de" ? "Wir haben einen Reset-Link an" : lang === "en" ? "We sent a reset link to" : "Nous avons envoyé un lien de réinitialisation à";
  const sentSuffix  = lang === "de" ? " gesendet" : "";

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-end sm:items-center justify-center sm:p-4 bv-auth-modal-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={onClose}
    >
      {/* Mobile: keep clearance for the bottom action bar so the modal never
          slides behind the lang/theme/profile cluster. Desktop: navbar above
          stays visible (bug button + nav). */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-auth-modal-outer { padding-bottom: calc(0.5rem + 72px) !important; }
        }
      `}</style>
      <div
        className="w-full sm:max-w-[420px] rounded-[22px] flex flex-col"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          animation: "bvFadeRise .28s var(--ease-out)",
          maxHeight: "calc(100dvh - 58px - 1.5rem)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="overflow-y-auto px-7 pt-7 sm:px-8 sm:pt-9 sm:pb-9" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))" }}>

          {/* Logo */}
          <div className="text-center mb-7">
            <span className="font-[family-name:var(--font-dm-serif)] italic"
              style={{ fontSize: "1.9rem", color: "var(--w)", letterSpacing: "-0.01em" }}>
              Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
            </span>
          </div>

          {checkEmail ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-5 w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
              <p className="text-[17px] font-semibold mb-2 tracking-tight" style={{ color: "var(--w)" }}>{t.pCheckEmail}</p>
              <p className="text-[13px] leading-relaxed mb-6" style={{ color: "var(--w3)" }}>
                {weSentLabel} <strong style={{ color: "var(--w2)" }}>{email}</strong>{sentSuffix}
              </p>
              <button onClick={() => reset("login")} className="text-[13px] underline underline-offset-4 hover:opacity-70 transition-opacity" style={{ color: "var(--gold)" }}>
                {t.pBackLogin}
              </button>
            </div>

          ) : resetSent ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-5 w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
              <p className="text-[17px] font-semibold mb-2 tracking-tight" style={{ color: "var(--w)" }}>{t.pCheckEmail}</p>
              <p className="text-[13px] leading-relaxed mb-6" style={{ color: "var(--w3)" }}>
                {weSentReset} <strong style={{ color: "var(--w2)" }}>{email}</strong>{sentSuffix}
              </p>
              <button onClick={() => reset("login")} className="text-[13px] underline underline-offset-4 hover:opacity-70 transition-opacity" style={{ color: "var(--gold)" }}>
                {t.pBackLogin}
              </button>
            </div>

          ) : (
            <>
              {/* Title */}
              <h2 className="text-center text-[18px] font-semibold mb-5 tracking-tight" style={{ color: "var(--w)" }}>
                {mode === "login"    ? t.pBtnLogin
                 : mode === "register" ? t.pBtnSignup
                 : (lang === "de" ? "Passwort zurücksetzen" : lang === "en" ? "Reset password" : "Réinitialiser le mot de passe")}
              </h2>

              <form onSubmit={handleSubmit} noValidate className="space-y-3">

                {mode === "register" && (
                  <>
                    <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                      placeholder={t.pFirstName} autoComplete="given-name"
                      style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                      placeholder={t.pLastName} autoComplete="family-name"
                      style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />
                  </>
                )}

                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder={t.phEmail} autoComplete="email"
                  style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />

                {mode !== "forgot" && (
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={mode === "register" ? t.pPasswordHint : t.pPassword}
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      style={{ ...fieldStyle, paddingRight: "44px" }}
                      onFocus={focusGold} onBlur={blurReset}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                )}

                {mode === "register" && (
                  <div className="relative">
                    <input
                      type={showConfirm ? "text" : "password"} value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder={t.pConfirmPassword} autoComplete="new-password"
                      style={{ ...fieldStyle, paddingRight: "44px" }}
                      onFocus={focusGold} onBlur={blurReset}
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)}
                      style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                )}

                {mode === "login" && (
                  <button type="button" onClick={() => reset("forgot")}
                    className="text-left text-[12px] hover:opacity-70 transition-opacity w-fit"
                    style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                    {lang === "de" ? "Passwort vergessen?" : lang === "en" ? "Forgot password?" : "Mot de passe oublié ?"}
                  </button>
                )}

                {error && (
                  <p className="text-[12.5px] px-3 py-2.5 rounded-xl"
                    style={{ background: "rgba(224,82,82,0.08)", color: "#e05252", border: "1px solid rgba(224,82,82,0.2)" }}>
                    {error}
                  </p>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-[13px] text-[14px] font-semibold tracking-wide transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
                  style={{
                    background: "var(--gold)",
                    color: "#131312",
                    marginTop: "4px",
                    borderRadius: "12px",
                    boxShadow: "0 4px 14px rgba(212,175,55,0.25)",
                    border: "none",
                  }}>
                  {loading ? "…" : mode === "login" ? t.pBtnLogin : mode === "register" ? t.pBtnSignup : (lang === "de" ? "Link senden" : lang === "en" ? "Send link" : "Envoyer le lien")}
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

              {/* Switch mode — bottom */}
              <p className="text-center text-[13px] mt-5" style={{ color: "var(--w3)" }}>
                {mode === "login" ? (
                  <>
                    {lang === "de" ? "Noch kein Konto?" : lang === "en" ? "Don't have an account yet?" : "Pas encore de compte ?"}{" "}
                    <button type="button" onClick={() => reset("register")}
                      className="font-semibold hover:opacity-80 transition-opacity"
                      style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}>
                      {t.pBtnSignup}
                    </button>
                  </>
                ) : mode === "register" ? (
                  <>
                    {lang === "de" ? "Bereits ein Konto?" : lang === "en" ? "Already have an account?" : "Déjà un compte ?"}{" "}
                    <button type="button" onClick={() => reset("login")}
                      className="font-semibold hover:opacity-80 transition-opacity"
                      style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}>
                      {t.pBtnLogin}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => reset("login")}
                    className="font-medium hover:opacity-70 transition-opacity"
                    style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer" }}>
                    {t.pBackLogin}
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
