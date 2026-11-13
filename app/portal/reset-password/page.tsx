"use client";

/**
 * SET A NEW PASSWORD — the screen that did not exist.
 *
 * Password reset was wired up halfway: AuthModal sent a recovery email, the
 * link landed on /portal/auth/callback, the callback exchanged the code for a
 * session and dropped her on the dashboard. She was logged in, her OLD password
 * was still the only one that worked, and nothing anywhere let her change it —
 * `supabase.auth.updateUser({ password })` appeared nowhere in the codebase.
 * Next visit she was locked out again, with no way through. For a nurse whose
 * passport, diploma and job application live behind that login, that is the end
 * of her application.
 *
 * A recovery link grants a real session, which is exactly what updateUser needs,
 * so this page is all that was missing. It is reachable two ways: the callback
 * routes here when it sees a recovery link, and /portal links here directly for
 * anyone already signed in who just wants to change their password.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { Spinner } from "@/components/ui/states";
import { Wordmark } from "@/components/Wordmark";
import { Card, Btn, Dot, KitStyle, STATUS_DOT, STATUS_TINT } from "@/components/fx/kit";
import { Check, Eye, EyeOff } from "lucide-react";

/** Supabase's own floor. Stated up front rather than after a failed attempt. */
const MIN_LEN = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (fr: string, en: string, de: string) => (lang === "de" ? de : lang === "en" ? en : fr);

  /** null = still checking, false = no session (link expired / opened cold). */
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A recovery link creates the session asynchronously, so check once now AND
  // listen — otherwise opening the email link goes straight to the "expired"
  // state on a slow connection, which is the same dead end being fixed.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled && session) setHasSession(true);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);

    if (pw.length < MIN_LEN) {
      setErr(T(`Le mot de passe doit contenir au moins ${MIN_LEN} caractères.`,
        `Your password must be at least ${MIN_LEN} characters.`,
        `Das Passwort muss mindestens ${MIN_LEN} Zeichen haben.`));
      return;
    }
    if (pw !== pw2) {
      setErr(T("Les deux mots de passe ne correspondent pas.",
        "The two passwords don't match.",
        "Die beiden Passwörter stimmen nicht überein."));
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        // supabase-js RESOLVES with an error rather than throwing, so this has
        // to be read explicitly — the pattern that made several other failures
        // on this site look like successes.
        const m = error.message || "";
        setErr(/same.*password|should be different/i.test(m)
          ? T("Choisissez un mot de passe différent de l'ancien.",
              "Choose a password different from your old one.",
              "Wählen Sie ein anderes Passwort als das alte.")
          : /weak|short|at least/i.test(m)
            ? T("Choisissez un mot de passe plus long.", "Choose a longer password.", "Wählen Sie ein längeres Passwort.")
            : T("Impossible de changer le mot de passe. Réessayez.",
                "Couldn't change your password. Please try again.",
                "Das Passwort konnte nicht geändert werden. Bitte erneut versuchen."));
        return;
      }
      setDone(true);
      setTimeout(() => router.replace("/portal/dashboard"), 1600);
    } catch {
      setErr(T("Erreur réseau. Réessayez.", "Network error. Please try again.", "Netzwerkfehler. Bitte erneut versuchen."));
    } finally {
      setBusy(false);
    }
  }

  // the one design (founder 2026-11-13): one small paper card, the logo on top (like the sign-in card),
  // serif title, kit fields, one black pill
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)", paddingTop: 58, paddingBottom: 40 }}>
      <KitStyle />
      <Card style={{ width: "100%", maxWidth: 380, padding: "30px 26px 26px" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}><Wordmark size="1.7rem" /></div>
        {children}
      </Card>
    </div>
  );
  const titleStyle: React.CSSProperties = { margin: 0, textAlign: "center", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 28, lineHeight: 1.15, letterSpacing: "-.01em", color: "var(--w)" };
  const subStyle: React.CSSProperties = { margin: "6px 0 20px", textAlign: "center", fontSize: 13.5, lineHeight: 1.55, color: "var(--w3)" };

  if (hasSession === null) return shell(<div className="flex justify-center" style={{ padding: "18px 0 6px" }}><Spinner size="md" /></div>);

  // Recovery links expire. Say so, and give her the way back rather than a
  // dead end — the whole point of this page.
  if (!hasSession) {
    return shell(
      <>
        <h1 style={titleStyle}>
          {T("Lien expiré", "Link expired", "Link abgelaufen")}
        </h1>
        <p style={subStyle}>
          {T("Ce lien de réinitialisation n'est plus valable. Demandez-en un nouveau depuis la page de connexion.",
            "This reset link is no longer valid. Ask for a new one from the sign-in page.",
            "Dieser Link ist nicht mehr gültig. Fordern Sie auf der Anmeldeseite einen neuen an.")}
        </p>
        <Btn kind="primary" onClick={() => router.replace("/portal")} style={{ width: "100%", height: 44 }}>
          {T("Retour à la connexion", "Back to sign in", "Zurück zur Anmeldung")}
        </Btn>
      </>,
    );
  }

  if (done) {
    return shell(
      <div className="text-center" style={{ padding: "4px 0" }}>
        <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 44, height: 44, borderRadius: "50%", background: STATUS_TINT.approved, color: STATUS_DOT.approved }}>
          <Check size={20} strokeWidth={2} />
        </span>
        <p style={{ ...titleStyle, marginTop: 12 }}>
          {T("Mot de passe modifié", "Password changed", "Passwort geändert")}
        </p>
        <p style={{ ...subStyle, marginBottom: 0 }}>
          {T("Redirection…", "Taking you back…", "Weiterleitung…")}
        </p>
      </div>,
    );
  }

  const field = {
    // 16px minimum: below it iOS Safari zooms the viewport on focus and never
    // zooms back out, which strands her mid-form on a phone. (The kit field is 14px.)
    fontSize: 16,
  } as const;

  return shell(
    <>
      <h1 style={titleStyle}>
        {T("Nouveau mot de passe", "New password", "Neues Passwort")}
      </h1>
      <p style={subStyle}>
        {T(`Au moins ${MIN_LEN} caractères.`, `At least ${MIN_LEN} characters.`, `Mindestens ${MIN_LEN} Zeichen.`)}
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <input
            className="bvk-input"
            type={show ? "text" : "password"}
            value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password" autoFocus
            placeholder={T("Nouveau mot de passe", "New password", "Neues Passwort")}
            aria-label={T("Nouveau mot de passe", "New password", "Neues Passwort")}
            style={{ ...field, paddingRight: 44 }}
          />
          <button type="button" onClick={() => setShow((s) => !s)}
            aria-label={show ? T("Masquer", "Hide", "Verbergen") : T("Afficher", "Show", "Anzeigen")}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", background: "none", border: "none", color: "var(--w3)", padding: 8, cursor: "pointer" }}>
            {show ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
          </button>
        </div>

        <input
          className="bvk-input"
          type={show ? "text" : "password"}
          value={pw2} onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
          placeholder={T("Confirmer", "Confirm", "Bestätigen")}
          aria-label={T("Confirmer le mot de passe", "Confirm password", "Passwort bestätigen")}
          style={field}
        />

        {err && (
          <p role="alert" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 12.5, lineHeight: 1.45, color: "var(--w)" }}>
            <Dot st="rejected" size={8} />{err}
          </p>
        )}

        <Btn kind="primary" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 4 }}>
          {busy && <Spinner size="sm" color="var(--bg)" />}
          {T("Enregistrer", "Save", "Speichern")}
        </Btn>
      </form>
    </>,
  );
}
