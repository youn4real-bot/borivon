"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { isValidEmail } from "@/lib/utils";
import { Suspense } from "react";

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

function PortalPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, lang } = useLang();

  // Invite code — URL param wins over localStorage (survives cross-browser email opens)
  const codeFromUrl = params.get("invite") ?? "";
  const codeFromStorage = typeof window !== "undefined" ? (localStorage.getItem("bv_invite_code") ?? "") : "";
  const prefilledCode = codeFromUrl || codeFromStorage;

  const [mode, setMode]               = useState<Mode>(() => params.get("mode") === "register" ? "register" : "login");
  const [firstName, setFirstName]     = useState("");
  const [lastName, setLastName]       = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [inviteCode, setInviteCode]   = useState(prefilledCode);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [checkEmail, setCheckEmail]   = useState(false);
  const [consent, setConsent]         = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  // 6-digit email verification (replaces the confirmation link).
  const [otp, setOtp]                 = useState("");
  const [otpErr, setOtpErr]           = useState("");
  const [otpBusy, setOtpBusy]         = useState(false);
  const [resendIn, setResendIn]       = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const inviteLocked = !!prefilledCode; // came via link — code is locked

  // Shared: once a session exists (auto-confirm OR after OTP verify), redeem
  // any pending invite and route by the resolved role. One place so the
  // signup + OTP paths can't drift.
  async function redeemAndRoute(code: string): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    // Parity with the old link/callback flow: notify admins of the new
    // signup. Server route is idempotent (dedupes by email) + only reached
    // on the signup/auto-confirm/OTP path (never plain login), so no spam.
    fetch("/api/portal/admin/signup-notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => { /* best-effort, mirrors old behavior */ });
    let inviteType: string | null = null;
    if (code) {
      try {
        const r = await fetch(`/api/portal/invite/${encodeURIComponent(code)}`, {
          method: "POST", headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (r.ok) inviteType = (await r.json()).type ?? null;
      } catch { /* ignore */ }
      try { localStorage.removeItem("bv_invite_code"); } catch { /* ignore */ }
    }
    let dest = "/portal/dashboard";
    if (inviteType === "member") dest = "/portal/org/dashboard";
    else if (inviteType === "sub-admin") dest = "/portal/admin";
    else {
      try {
        const rr = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const { role } = await rr.json().catch(() => ({}));
        if (role === "org_member") dest = "/portal/org/dashboard";
        else if (role === "admin" || role === "sub_admin") dest = "/portal/admin";
      } catch { /* default candidate dashboard */ }
    }
    router.replace(dest);
    return true;
  }

  async function verifyCode() {
    if (otp.trim().length !== 6 || otpBusy) return;
    setOtpBusy(true); setOtpErr("");
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(), token: otp.trim(), type: "signup",
      });
      if (err) {
        const m = err.message || "";
        setOtpErr(
          /expired/i.test(m)
            ? (lang === "de" ? "Code abgelaufen — neuen anfordern." : lang === "fr" ? "Code expiré — demandez-en un nouveau." : "Code expired — request a new one.")
            : /invalid|incorrect|token|otp/i.test(m)
            ? (lang === "de" ? "Falscher Code." : lang === "fr" ? "Code incorrect." : "Incorrect code.")
            : m,
        );
        setOtpBusy(false); return;
      }
    } catch {
      setOtpErr(t.pErrNetwork); setOtpBusy(false); return;
    }
    try { if (await redeemAndRoute(inviteCode.trim())) return; } catch { /* fall through */ }
    router.replace("/portal/dashboard");
  }

  async function resendCode() {
    if (resendIn > 0 || otpBusy) return;
    setOtpErr("");
    try {
      await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
      setResendIn(30);
    } catch {
      setOtpErr(t.pErrNetwork);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!isValidEmail(email)) { setError(t.pErrEmail); return; }
    if (password.length < 6)  { setError(t.pErrPassword); return; }

    if (mode === "register") {
      if (!firstName.trim()) { setError(t.pErrFirstName); return; }
      if (!lastName.trim())  { setError(t.pErrLastName); return; }
      if (password !== confirmPassword) { setError(t.pErrPasswordMatch); return; }
      if (!consent)      { setError(t.pConsentRequired); return; }
      if (!dataConsent)  { setError(t.pDataConsentRequired); return; }

      const code = inviteCode.trim();

      // ── Invite gate — registration is by invitation only ──────────────────
      if (!code) {
        setError(lang === "de"
          ? "Registrierung nur auf Einladung. Bitte Einladungscode eingeben."
          : lang === "fr"
          ? "Inscription sur invitation uniquement. Veuillez entrer votre code d'invitation."
          : "Registration is by invitation only. Please enter your invite code.");
        return;
      }

      // Validate the code before creating the account
      setLoading(true);
      const checkRes = await fetch(`/api/portal/invite/${encodeURIComponent(code)}`);
      if (checkRes.status === 410) {
        setError(lang === "de"
          ? "Dieser Einladungslink wurde bereits verwendet."
          : lang === "fr"
          ? "Ce code d'invitation a déjà été utilisé."
          : "This invite code has already been used.");
        setLoading(false); return;
      }
      if (!checkRes.ok) {
        setError(lang === "de"
          ? "Ungültiger Einladungscode."
          : lang === "fr"
          ? "Code d'invitation invalide."
          : "Invalid invite code.");
        setLoading(false); return;
      }

      // Block re-signup of existing accounts. Supabase's auth.signUp silently
      // re-sends a confirmation email when the address already exists, leaking
      // nothing to the caller — so we precheck via service role.
      try {
        const exRes = await fetch("/api/portal/check-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
        const exJson = await exRes.json().catch(() => ({}));
        if (exJson?.exists) {
          setError(t.pErrExists);
          setLoading(false); return;
        }
      } catch { /* network blip — fall through, supabase will still gate */ }

      // Code is valid — sign up and bake the code into the confirmation email URL
      try {
        const { error: err } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password,
          options: {
            data: { first_name: firstName.trim(), last_name: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` },
            emailRedirectTo: `${window.location.origin}/portal/auth/callback?invite=${encodeURIComponent(code)}`,
          },
        });
        if (err) {
          const m = err.message;
          const isNetwork = /failed to fetch|networkerror|network request failed|load failed/i.test(m);
          setError(isNetwork ? t.pErrNetwork : m === "User already registered" ? t.pErrExists : m);
          setLoading(false); return;
        }
      } catch {
        setError(t.pErrNetwork);
        setLoading(false); return;
      }
      // Keep code in localStorage as belt-and-suspenders fallback
      try { localStorage.setItem("bv_invite_code", code); } catch { /* private mode */ }

      // If Supabase auto-confirms signups, a session exists RIGHT NOW and the
      // user never sees the email-confirmation link (which is the only place
      // the invite gets redeemed). Redeem here too so a sub-admin link works
      // regardless of the email-confirmation setting — otherwise they'd land
      // on the candidate portal. (Email-confirm ON → no session yet → fall
      // through to the "check your email" screen; callback redeems later.)
      // Auto-confirm ON → session exists now → redeem + route immediately.
      try {
        if (await redeemAndRoute(code)) { setLoading(false); return; }
      } catch { /* getSession blip — fall through to the code screen */ }

      // Email-confirm ON → no session yet → show the 6-digit code screen.
      setCheckEmail(true); setLoading(false); return;
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      });
      if (err) {
        const m = err.message;
        const isNetwork = /failed to fetch|networkerror|network request failed|load failed/i.test(m);
        setError(
          isNetwork                          ? t.pErrNetwork :
          m === "Invalid login credentials"  ? t.pErrWrong :
          m === "Email not confirmed"        ? t.pErrNotConfirmed : m
        );
        setLoading(false); return;
      }
    } catch {
      setError(t.pErrNetwork);
      setLoading(false); return;
    }

    // Auto-redeem invite if present (URL param > localStorage)
    const redeemCode = inviteCode.trim() || codeFromUrl || codeFromStorage;
    let inviteType: string | null = null;
    if (redeemCode) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        try {
          const invRes = await fetch(`/api/portal/invite/${encodeURIComponent(redeemCode)}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (invRes.ok) {
            const invJson = await invRes.json();
            inviteType = invJson.type ?? null;
          }
        } catch { /* ignore */ }
        try { localStorage.removeItem("bv_invite_code"); } catch { /* ignore */ }
      }
    }

    // If no invite to redeem, check existing role
    let roleDest: string | null = null;
    if (!inviteType) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${session.access_token}` } });
          const { role } = await roleRes.json().catch(() => ({}));
          if (role === "org_member") inviteType = "member";
          else if (role === "admin" || role === "sub_admin") roleDest = "/portal/admin";
        }
      } catch { /* ignore */ }
    }

    router.replace(
      roleDest ??
      (inviteType === "member"    ? "/portal/org/dashboard" :
       inviteType === "sub-admin" ? "/portal/admin" :
                                    "/portal/dashboard"),
    );
  }

  function switchMode(m: Mode) {
    setMode(m); setError(""); setCheckEmail(false);
    setOtp(""); setOtpErr(""); setResendIn(0);
    setFirstName(""); setLastName(""); setPassword(""); setConfirmPassword("");
    setShowPassword(false); setShowConfirm(false);
    setConsent(false); setDataConsent(false);
    if (!prefilledCode) setInviteCode(""); // only clear if not prefilled
  }

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
          <h1 className="text-[20px] font-semibold mb-2" style={{ color: "var(--w)" }}>
            {lang === "de" ? "Code eingeben" : lang === "fr" ? "Entrez le code" : "Enter your code"}
          </h1>
          <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: "var(--w3)" }}>
            {(lang === "de"
              ? "Wir haben einen 6-stelligen Code an {e} gesendet."
              : lang === "fr"
              ? "Nous avons envoyé un code à 6 chiffres à {e}."
              : "We sent a 6-digit code to {e}.").replace("{e}", email)}
          </p>

          <input
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={e => { if (e.key === "Enter" && otp.length === 6) verifyCode(); }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="••••••"
            className="w-full text-center rounded-xl px-4 py-3 outline-none mb-3"
            style={{
              background: "var(--bg2)", border: `1px solid ${otpErr ? "var(--danger)" : "var(--border)"}`,
              color: "var(--w)", fontSize: "1.4rem", letterSpacing: "0.5em", fontWeight: 600,
            }}
          />
          {otpErr && (
            <p className="text-[12.5px] mb-3" style={{ color: "var(--danger)" }}>{otpErr}</p>
          )}

          <button onClick={verifyCode} disabled={otp.length !== 6 || otpBusy}
            className="w-full py-3 rounded-xl text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 mb-3"
            style={{ background: "var(--gold)", color: "#131312" }}>
            {otpBusy ? "…" : (lang === "de" ? "Bestätigen" : lang === "fr" ? "Vérifier" : "Verify")}
          </button>

          <div className="flex items-center justify-center gap-4 text-[12.5px]">
            <button onClick={resendCode} disabled={resendIn > 0 || otpBusy}
              className="underline underline-offset-4 transition-opacity hover:opacity-70 disabled:opacity-40 disabled:no-underline"
              style={{ color: "var(--gold)" }}>
              {resendIn > 0
                ? (lang === "de" ? `Erneut senden (${resendIn}s)` : lang === "fr" ? `Renvoyer (${resendIn}s)` : `Resend (${resendIn}s)`)
                : (lang === "de" ? "Code erneut senden" : lang === "fr" ? "Renvoyer le code" : "Resend code")}
            </button>
            <button onClick={() => switchMode("login")}
              className="underline underline-offset-4 transition-opacity hover:opacity-70"
              style={{ color: "var(--w3)" }}>{t.pBackLogin}</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)", paddingBottom: "3rem" }}>
      <div className="w-full max-w-[420px]">
        <div className="px-8 py-10"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "var(--shadow-lg)" }}>

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
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder={t.pFirstName} autoComplete="given-name" style={fieldStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")} />
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder={t.pLastName} autoComplete="family-name" style={fieldStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")} />
              </>
            )}

            {/* Email */}
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={t.phEmail} autoComplete="email" style={fieldStyle}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
              onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")} />

            {/* Password */}
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === "register" ? t.pPasswordHint : t.pPassword}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                style={{ ...fieldStyle, paddingRight: "44px" }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                <EyeIcon open={showPassword} />
              </button>
            </div>

            {/* Confirm password — register only */}
            {mode === "register" && (
              <div className="relative">
                <input type={showConfirm ? "text" : "password"} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t.pConfirmPassword} autoComplete="new-password"
                  style={{ ...fieldStyle, paddingRight: "44px" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")} />
                <button type="button" onClick={() => setShowConfirm(v => !v)}
                  style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            )}

            {/* Invite code — register only */}
            {mode === "register" && (
              inviteLocked ? (
                /* Came via invite link — show as verified pill */
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
                  style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  <span className="text-[12.5px] font-medium" style={{ color: "var(--success)" }}>
                    Invite code verified
                  </span>
                </div>
              ) : (
                /* No link — let them paste the code */
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.trim())}
                  placeholder={lang === "de" ? "Einladungscode" : lang === "fr" ? "Code d'invitation" : "Invite code"}
                  autoComplete="off"
                  style={{ ...fieldStyle, fontFamily: "monospace", letterSpacing: "0.06em" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "var(--border2)")}
                />
              )
            )}

            {/* Error */}
            {error && (
              <p className="text-[12.5px] px-3 py-2.5 rounded-xl"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-4 text-[14px] font-semibold tracking-wide transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
              style={{ background: "var(--gold)", color: "#131312", marginTop: "4px", borderRadius: "12px", boxShadow: "var(--shadow-gold-sm)", border: "none" }}>
              {loading ? "…" : mode === "login" ? t.pBtnLogin : t.pBtnSignup}
            </button>
          </form>

          {/* Consent — register only */}
          {mode === "register" && (
            <div className="mt-4 flex flex-col gap-2.5">
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

export default function PortalPage() {
  return (
    <Suspense fallback={null}>
      <PortalPageInner />
    </Suspense>
  );
}
