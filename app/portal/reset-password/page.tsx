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
import { Lock, CheckCircle2, Eye, EyeOff } from "lucide-react";

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

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "var(--bg2)" }}>
      <div className="w-full max-w-sm p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20 }}>
        {children}
      </div>
    </div>
  );

  if (hasSession === null) return shell(<div className="flex justify-center py-8"><Spinner size="md" /></div>);

  // Recovery links expire. Say so, and give her the way back rather than a
  // dead end — the whole point of this page.
  if (!hasSession) {
    return shell(
      <>
        <h1 className="text-[17px] font-bold mb-2" style={{ color: "var(--w)" }}>
          {T("Lien expiré", "Link expired", "Link abgelaufen")}
        </h1>
        <p className="text-[13.5px] mb-5" style={{ color: "var(--w2)" }}>
          {T("Ce lien de réinitialisation n'est plus valable. Demandez-en un nouveau depuis la page de connexion.",
            "This reset link is no longer valid. Ask for a new one from the sign-in page.",
            "Dieser Link ist nicht mehr gültig. Fordern Sie auf der Anmeldeseite einen neuen an.")}
        </p>
        <button onClick={() => router.replace("/portal")}
          className="w-full py-3 text-[14px] font-semibold bv-tap"
          style={{ background: "var(--gold)", color: "#131312", borderRadius: 14, border: "none" }}>
          {T("Retour à la connexion", "Back to sign in", "Zurück zur Anmeldung")}
        </button>
      </>,
    );
  }

  if (done) {
    return shell(
      <div className="text-center py-4">
        <CheckCircle2 size={40} strokeWidth={1.8} style={{ color: "var(--success)" }} className="mx-auto mb-3" />
        <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>
          {T("Mot de passe modifié", "Password changed", "Passwort geändert")}
        </p>
        <p className="text-[13px] mt-1" style={{ color: "var(--w3)" }}>
          {T("Redirection…", "Taking you back…", "Weiterleitung…")}
        </p>
      </div>,
    );
  }

  const field = {
    width: "100%", padding: "12px 14px",
    background: "var(--bg2)", border: "1px solid var(--border)",
    borderRadius: 12, color: "var(--w)",
    // 16px minimum: below it iOS Safari zooms the viewport on focus and never
    // zooms back out, which strands her mid-form on a phone.
    fontSize: 16,
  } as const;

  return shell(
    <>
      <div className="flex items-center gap-2 mb-1">
        <Lock size={16} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
        <h1 className="text-[17px] font-bold" style={{ color: "var(--w)" }}>
          {T("Nouveau mot de passe", "New password", "Neues Passwort")}
        </h1>
      </div>
      <p className="text-[13px] mb-5" style={{ color: "var(--w3)" }}>
        {T(`Au moins ${MIN_LEN} caractères.`, `At least ${MIN_LEN} characters.`, `Mindestens ${MIN_LEN} Zeichen.`)}
      </p>

      <form onSubmit={submit} className="grid gap-3">
        <div style={{ position: "relative" }}>
          <input
            type={show ? "text" : "password"}
            value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password" autoFocus
            placeholder={T("Nouveau mot de passe", "New password", "Neues Passwort")}
            aria-label={T("Nouveau mot de passe", "New password", "Neues Passwort")}
            style={{ ...field, paddingRight: 44 }}
          />
          <button type="button" onClick={() => setShow((s) => !s)}
            aria-label={show ? T("Masquer", "Hide", "Verbergen") : T("Afficher", "Show", "Anzeigen")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--w3)", padding: 8, cursor: "pointer" }}>
            {show ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
          </button>
        </div>

        <input
          type={show ? "text" : "password"}
          value={pw2} onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
          placeholder={T("Confirmer", "Confirm", "Bestätigen")}
          aria-label={T("Confirmer le mot de passe", "Confirm password", "Passwort bestätigen")}
          style={field}
        />

        {err && (
          <p role="alert" className="text-[12.5px]" style={{ color: "var(--danger)" }}>{err}</p>
        )}

        <button type="submit" disabled={busy}
          className="w-full py-3 text-[14px] font-semibold bv-tap inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--gold)", color: "#131312", borderRadius: 14, border: "none" }}>
          {busy && <Spinner size="sm" />}
          {T("Enregistrer", "Save", "Speichern")}
        </button>
      </form>
    </>,
  );
}
