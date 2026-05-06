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
  // Invite code — mandatory for registration
  const [inviteCode, setInviteCode]           = useState("");
  const [inviteStatus, setInviteStatus]       = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [inviteOrgName, setInviteOrgName]     = useState("");

  // Close on Escape — disabled while a submit is in flight so a stray Esc
  // can't abort signup/login mid-request.
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape" && !loading) onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open, onClose, loading]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setMode("login");
      setFirstName(""); setLastName("");
      setEmail(""); setPassword(""); setConfirmPassword("");
      setShowPassword(false); setShowConfirm(false);
      setError(""); setCheckEmail(false); setResetSent(false);
      setConsent(false); setDataConsent(false); setLoading(false);
      setInviteCode(""); setInviteStatus("idle"); setInviteOrgName("");
    }
  }, [open]);

  // Validate invite code on blur — debounced so it doesn't fire on every keystroke
  async function validateInviteCode(code: string) {
    const trimmed = code.trim().toUpperCase().replace(/[\s-]+/g, "");
    if (!trimmed) { setInviteStatus("idle"); setInviteOrgName(""); return; }
    setInviteStatus("checking");
    try {
      const res = await fetch(`/api/portal/invite/${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const json = await res.json();
        setInviteOrgName(json.org?.name ?? "");
        setInviteStatus("valid");
      } else {
        setInviteStatus("invalid");
        setInviteOrgName("");
      }
    } catch {
      setInviteStatus("invalid");
      setInviteOrgName("");
    }
  }

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
    setInviteCode(""); setInviteStatus("idle"); setInviteOrgName("");
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
      // Invite code is mandatory — validate before creating account
      const trimmedCode = inviteCode.trim().toUpperCase().replace(/[\s-]+/g, "");
      if (!trimmedCode) {
        setError(lang === "de" ? "Bitte geben Sie Ihren Einladungscode ein." : lang === "en" ? "Please enter your invitation code." : "Veuillez saisir votre code d'invitation.");
        return;
      }
      if (inviteStatus === "invalid") {
        setError(lang === "de" ? "Ungültiger Einladungscode." : lang === "en" ? "Invalid invitation code." : "Code d'invitation invalide.");
        return;
      }
      // If status is idle (user didn't blur) — validate now
      if (inviteStatus === "idle" || inviteStatus === "checking") {
        setLoading(true);
        try {
          const res = await fetch(`/api/portal/invite/${encodeURIComponent(trimmedCode)}`);
          if (!res.ok) {
            setError(lang === "de" ? "Ungültiger Einladungscode." : lang === "en" ? "Invalid invitation code." : "Code d'invitation invalide.");
            setInviteStatus("invalid");
            setLoading(false);
            return;
          }
          const json = await res.json();
          setInviteOrgName(json.org?.name ?? "");
          setInviteStatus("valid");
        } catch {
          setError(lang === "de" ? "Verbindungsfehler — bitte erneut versuchen." : lang === "fr" ? "Erreur de connexion — veuillez réessayer." : "Connection error — please try again.");
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    setLoading(true);

    if (mode === "register") {
      const finalCode = inviteCode.trim().toUpperCase().replace(/[\s-]+/g, "");
      // Block re-registration for any already-registered account (admin, candidate, org member).
      try {
        const checkRes = await fetch("/api/portal/check-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
        const checkJson = await checkRes.json();
        if (checkJson.exists) {
          setError(
            lang === "de" ? "Diese E-Mail ist bereits registriert. Bitte melden Sie sich an." :
            lang === "fr" ? "Cet e-mail est déjà enregistré. Veuillez vous connecter." :
            "This email is already registered. Please log in instead."
          );
          setLoading(false); return;
        }
      } catch {
        // If the check fails, let Supabase handle it below
      }
      const { data: signUpData, error: err } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: {
          data: {
            first_name: firstName.trim(), last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`,
            invite_code: finalCode,
          },
          emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
        },
      });
      if (err) {
        setError(err.message === "User already registered" ? t.pErrExists : err.message);
        setLoading(false); return;
      }
      // Supabase silently accepts signUp for an existing email when confirmation
      // is enabled (no error, no session, but identities array is empty). Detect
      // this to avoid corrupting the existing account's email_confirmed_at.
      if ((signUpData?.user?.identities?.length ?? 1) === 0) {
        setError(t.pErrExists);
        setLoading(false); return;
      }
      // If email confirmation is disabled, Supabase returns a session immediately
      if (signUpData?.session) {
        onClose();
        router.replace("/portal/dashboard");
        return;
      }
      // Otherwise show "check your email" screen
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
      role="dialog"
      aria-modal="true"
      aria-label="Borivon"
      className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-end sm:items-center justify-center sm:p-4 bv-auth-modal-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={() => { if (!loading) onClose(); }}
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
                      placeholder={t.pFirstName} aria-label={t.pFirstName} autoComplete="given-name" required aria-required="true"
                      style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                      placeholder={t.pLastName} aria-label={t.pLastName} autoComplete="family-name" required aria-required="true"
                      style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />
                    {/* Invite code — mandatory */}
                    <div className="relative">
                      <input
                        type="text"
                        value={inviteCode}
                        onChange={e => {
                          const v = e.target.value.toUpperCase();
                          setInviteCode(v);
                          setInviteStatus("idle");
                          setInviteOrgName("");
                        }}
                        onBlur={() => validateInviteCode(inviteCode)}
                        placeholder={
                          lang === "de" ? "Einladungscode *" :
                          lang === "en" ? "Invitation code *" :
                          "Code d'invitation *"
                        }
                        aria-label={lang === "de" ? "Einladungscode" : lang === "en" ? "Invitation code" : "Code d'invitation"}
                        aria-invalid={inviteStatus === "invalid"}
                        required aria-required="true"
                        autoComplete="off"
                        style={{
                          ...fieldStyle,
                          fontFamily: "monospace",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          paddingRight: "40px",
                          borderColor: inviteStatus === "valid" ? "var(--success-border)" : inviteStatus === "invalid" ? "var(--danger-border)" : "transparent",
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = inviteStatus === "valid" ? "var(--success-border)" : inviteStatus === "invalid" ? "var(--danger-border)" : "var(--gold)")}
                      />
                      {/* Status indicator — decorative SVGs hidden from SR
                          (the live region below carries the meaning). */}
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center" aria-hidden="true">
                        {inviteStatus === "checking" && (
                          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--w3)" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        )}
                        {inviteStatus === "valid" && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                        {inviteStatus === "invalid" && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        )}
                      </span>
                    </div>
                    {/* Feedback line below invite code — announced to screen
                        readers when the validation result changes. */}
                    <div role="status" aria-live="polite" className="contents">
                    {inviteStatus === "valid" && inviteOrgName && (
                      <p className="text-[11.5px] -mt-1 px-1" style={{ color: "var(--success)" }}>
                        ✓ {lang === "de" ? `Einladung von ${inviteOrgName} akzeptiert` : lang === "en" ? `Invitation from ${inviteOrgName} accepted` : `Invitation de ${inviteOrgName} acceptée`}
                      </p>
                    )}
                    {inviteStatus === "invalid" && (
                      <p className="text-[11.5px] -mt-1 px-1" style={{ color: "var(--danger)" }}>
                        {lang === "de" ? "Ungültiger Code — bitte prüfen" : lang === "en" ? "Invalid code — please check" : "Code invalide — veuillez vérifier"}
                      </p>
                    )}
                    </div>
                  </>
                )}

                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder={t.phEmail} aria-label={t.phEmail} autoComplete="email" required aria-required="true"
                  style={fieldStyle} onFocus={focusGold} onBlur={blurReset} />

                {mode !== "forgot" && (
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={mode === "register" ? t.pPasswordHint : t.pPassword}
                      aria-label={mode === "register" ? t.pPasswordHint : t.pPassword}
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      required aria-required="true"
                      style={{ ...fieldStyle, paddingRight: "44px" }}
                      onFocus={focusGold} onBlur={blurReset}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? (lang === "de" ? "Passwort ausblenden" : lang === "fr" ? "Masquer le mot de passe" : "Hide password") : (lang === "de" ? "Passwort anzeigen" : lang === "fr" ? "Afficher le mot de passe" : "Show password")}
                      aria-pressed={showPassword}
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
                      placeholder={t.pConfirmPassword} aria-label={t.pConfirmPassword} autoComplete="new-password" required aria-required="true"
                      style={{ ...fieldStyle, paddingRight: "44px" }}
                      onFocus={focusGold} onBlur={blurReset}
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)}
                      aria-label={showConfirm ? (lang === "de" ? "Passwort ausblenden" : lang === "fr" ? "Masquer le mot de passe" : "Hide password") : (lang === "de" ? "Passwort anzeigen" : lang === "fr" ? "Afficher le mot de passe" : "Show password")}
                      aria-pressed={showConfirm}
                      style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                )}

                <div role="alert" aria-live="assertive">
                {error && (
                  <div className="text-[12.5px] px-3 py-2.5 rounded-xl flex flex-col gap-1.5"
                    style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                    <span>{error}</span>
                    {/* When the credentials are wrong, surface the password-reset
                        path right next to the error so the user sees it immediately. */}
                    {mode === "login" && (
                      <button type="button" onClick={() => reset("forgot")}
                        className="text-left text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity w-fit"
                        style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                        {lang === "de" ? "Passwort zurücksetzen →" : lang === "en" ? "Reset your password →" : "Réinitialiser le mot de passe →"}
                      </button>
                    )}
                  </div>
                )}
                </div>

                {mode === "login" && !error && (
                  <button type="button" onClick={() => reset("forgot")}
                    className="text-left text-[12.5px] font-medium hover:opacity-70 transition-opacity w-fit"
                    style={{ color: "var(--gold)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                    {lang === "de" ? "Passwort vergessen?" : lang === "en" ? "Forgot password?" : "Mot de passe oublié ?"}
                  </button>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-[13px] text-[14px] font-semibold tracking-wide transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
                  style={{
                    background: "var(--gold)",
                    color: "#131312",
                    marginTop: "4px",
                    borderRadius: "12px",
                    boxShadow: "0 4px 14px var(--border-gold)",
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
                        {consent && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#131312" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
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
                        {dataConsent && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#131312" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
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
