"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";

type InviteInfo = {
  org: { id: string; name: string };
  type: "candidate" | "member";
};

const T = {
  en: {
    alreadyUsedTitle: "This invite has already been used",
    alreadyUsedBody: "Each link is for one person only. Contact your Borivon representative for a new one.",
    backToSignIn: "Back to sign in",
    invalidTitle: "Invalid invite link",
    invalidBody: "This link has expired or doesn't exist. Ask your Borivon representative for a new one.",
    joinedTitle: "You're in!",
    joinedBody: "Taking you to your dashboard…",
    memberHeadline: "Welcome to the team.",
    candidateHeadline: "Congratulations.",
    memberBodyIntro: "Borivon is inviting you to manage",
    memberBodyOrg: "your organization",
    candidateBodyMain: "Borivon has selected you. Your mission starts here.",
    candidateBodySub: "Create your account to unlock your full candidate profile and begin your journey to Germany.",
    memberBodySub: "Set up your admin account to manage candidates and track their progress.",
    ctaMember: "Set up my account →",
    ctaCandidate: "Start my journey →",
    alreadyHaveAccount: "I already have an account",
    termsPrefix: "By joining, you agree to Borivon's",
    termsLink: "Terms",
  },
  fr: {
    alreadyUsedTitle: "Cette invitation a déjà été utilisée",
    alreadyUsedBody: "Chaque lien est pour une seule personne. Contactez votre représentant Borivon pour en obtenir un nouveau.",
    backToSignIn: "Retour à la connexion",
    invalidTitle: "Lien d'invitation invalide",
    invalidBody: "Ce lien a expiré ou n'existe pas. Demandez un nouveau à votre représentant Borivon.",
    joinedTitle: "Vous êtes inscrit !",
    joinedBody: "Redirection vers votre tableau de bord…",
    memberHeadline: "Bienvenue dans l'équipe.",
    candidateHeadline: "Félicitations.",
    memberBodyIntro: "Borivon vous invite à gérer",
    memberBodyOrg: "votre organisation",
    candidateBodyMain: "Borivon vous a sélectionné. Votre mission commence ici.",
    candidateBodySub: "Créez votre compte pour débloquer votre profil candidat complet et commencer votre parcours vers l'Allemagne.",
    memberBodySub: "Configurez votre compte admin pour gérer les candidats et suivre leur progression.",
    ctaMember: "Configurer mon compte →",
    ctaCandidate: "Commencer mon parcours →",
    alreadyHaveAccount: "J'ai déjà un compte",
    termsPrefix: "En rejoignant, vous acceptez les",
    termsLink: "Conditions d'utilisation",
  },
  de: {
    alreadyUsedTitle: "Diese Einladung wurde bereits verwendet",
    alreadyUsedBody: "Jeder Link gilt nur für eine Person. Wenden Sie sich an Ihren Borivon-Vertreter für einen neuen.",
    backToSignIn: "Zurück zur Anmeldung",
    invalidTitle: "Ungültiger Einladungslink",
    invalidBody: "Dieser Link ist abgelaufen oder existiert nicht. Bitten Sie Ihren Borivon-Vertreter um einen neuen.",
    joinedTitle: "Sie sind dabei!",
    joinedBody: "Sie werden zu Ihrem Dashboard weitergeleitet…",
    memberHeadline: "Willkommen im Team.",
    candidateHeadline: "Herzlichen Glückwunsch.",
    memberBodyIntro: "Borivon lädt Sie ein, zu verwalten",
    memberBodyOrg: "Ihre Organisation",
    candidateBodyMain: "Borivon hat Sie ausgewählt. Ihre Mission beginnt hier.",
    candidateBodySub: "Erstellen Sie Ihr Konto, um Ihr vollständiges Kandidatenprofil freizuschalten und Ihre Reise nach Deutschland zu beginnen.",
    memberBodySub: "Richten Sie Ihr Admin-Konto ein, um Kandidaten zu verwalten und ihren Fortschritt zu verfolgen.",
    ctaMember: "Konto einrichten →",
    ctaCandidate: "Meine Reise starten →",
    alreadyHaveAccount: "Ich habe bereits ein Konto",
    termsPrefix: "Mit dem Beitreten stimmen Sie",
    termsLink: "Nutzungsbedingungen von Borivon",
  },
};

export default function JoinPage() {
  const { lang } = useLang();
  const i18n = T[lang] ?? T.en;
  const { code } = useParams<{ code: string }>();
  const router    = useRouter();

  const [info,        setInfo]        = useState<InviteInfo | null>(null);
  const [invalid,     setInvalid]     = useState(false);
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [redeeming,   setRedeeming]   = useState(false);
  const [joined,      setJoined]      = useState(false);
  const [error,       setError]       = useState("");

  useEffect(() => {
    if (!code) { setInvalid(true); setLoading(false); return; }

    fetch(`/api/portal/invite/${encodeURIComponent(code)}`)
      .then(async r => {
        if (r.status === 410) { setAlreadyUsed(true); setLoading(false); return null; }
        return r.ok ? r.json() : null;
      })
      .then(async data => {
        if (data === null) return;
        if (!data?.org) { setInvalid(true); setLoading(false); return; }
        setInfo(data as InviteInfo);

        // If already logged in → auto-redeem
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          setRedeeming(true);
          try {
            const res = await fetch(`/api/portal/invite/${encodeURIComponent(code)}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
              const json = await res.json();
              setJoined(true);
              setTimeout(() => {
                router.replace(json.type === "member" ? "/portal/org/dashboard" : "/portal/dashboard");
              }, 1800);
            } else {
              const json = await res.json().catch(() => ({}));
              if (json?.error === "already_used") setAlreadyUsed(true);
              else setError("Something went wrong. Please try again.");
            }
          } catch {
            setError("Connection error. Please try again.");
          }
          setRedeeming(false);
        }
        setLoading(false);
      })
      .catch(() => { setInvalid(true); setLoading(false); });
  }, [code, router]);

  function goTo(mode: "register" | "login") {
    try {
      if (typeof window !== "undefined") localStorage.setItem("bv_invite_code", code);
    } catch { /* private mode */ }
    router.push(`/portal?invite=${encodeURIComponent(code)}&mode=${mode}`);
  }

  // ── Shared layout shell ───────────────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <main className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--bg)" }}>
      <p className="text-[22px] font-semibold italic mb-10 tracking-tight"
        style={{ fontFamily: "var(--font-dm-serif)", color: "var(--w)" }}>
        Borivon<span style={{ color: "var(--gold)" }}>.</span>
      </p>
      <div className="w-full max-w-[400px] text-center">
        {children}
      </div>
    </main>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center"><Spinner size="lg" /></div>
      </Shell>
    );
  }

  // ── Already used ──────────────────────────────────────────────────────────
  if (alreadyUsed) {
    return (
      <Shell>
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
          <span style={{ color: "var(--danger)", fontSize: 22 }}>✕</span>
        </div>
        <p className="text-[17px] font-semibold mb-2" style={{ color: "var(--w)" }}>
          {i18n.alreadyUsedTitle}
        </p>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: "var(--w3)" }}>
          {i18n.alreadyUsedBody}
        </p>
        <a href="/portal" className="text-[13px] underline underline-offset-4 hover:opacity-80 transition-opacity"
          style={{ color: "var(--gold)" }}>
          {i18n.backToSignIn}
        </a>
      </Shell>
    );
  }

  // ── Invalid ───────────────────────────────────────────────────────────────
  if (invalid) {
    return (
      <Shell>
        <p className="text-[17px] font-semibold mb-2" style={{ color: "var(--w)" }}>
          {i18n.invalidTitle}
        </p>
        <p className="text-[13px] mb-6" style={{ color: "var(--w3)" }}>
          {i18n.invalidBody}
        </p>
        <a href="/portal" className="text-[13px] underline underline-offset-4 hover:opacity-80 transition-opacity"
          style={{ color: "var(--gold)" }}>
          {i18n.backToSignIn}
        </a>
      </Shell>
    );
  }

  // ── Joined ────────────────────────────────────────────────────────────────
  if (joined) {
    return (
      <Shell>
        <div className="text-5xl mb-5">🎉</div>
        <p className="text-[20px] font-semibold mb-2 tracking-tight" style={{ color: "var(--w)" }}>
          {i18n.joinedTitle}
        </p>
        <p className="text-[13.5px]" style={{ color: "var(--w3)" }}>{i18n.joinedBody}</p>
      </Shell>
    );
  }

  const isMember = info?.type === "member";
  // Only show org name if it's a real org (not the "Borivon" placeholder for standalone invites)
  const showOrg = isMember && info?.org.name && info.org.name !== "Borivon";

  // ── Main invite page ──────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-[400px]">

        {/* Logo */}
        <p className="text-center text-[22px] font-semibold italic mb-10 tracking-tight"
          style={{ fontFamily: "var(--font-dm-serif)", color: "var(--w)" }}>
          Borivon<span style={{ color: "var(--gold)" }}>.</span>
        </p>

        {/* Card */}
        <div className="rounded-3xl px-8 py-9 text-center"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border-gold)",
            boxShadow: "0 0 0 1px var(--gdim), 0 20px 60px rgba(0,0,0,0.18)",
          }}>

          {/* Celebration icon */}
          <div className="text-5xl mb-5 select-none" style={{ lineHeight: 1 }}>
            {isMember ? "🏆" : "🎯"}
          </div>

          {/* Headline */}
          <h1 className="text-[22px] font-semibold tracking-tight mb-3" style={{ color: "var(--w)" }}>
            {isMember ? i18n.memberHeadline : i18n.candidateHeadline}
          </h1>

          {/* Body */}
          <p className="text-[14px] leading-relaxed mb-2" style={{ color: "var(--w2)" }}>
            {isMember
              ? <>{i18n.memberBodyIntro}{showOrg ? <> <strong style={{ color: "var(--gold)" }}>{info?.org.name}</strong></> : ` ${i18n.memberBodyOrg}`}.</>
              : i18n.candidateBodyMain
            }
          </p>
          {!isMember && (
            <p className="text-[12.5px] mb-7 leading-relaxed" style={{ color: "var(--w3)" }}>
              {i18n.candidateBodySub}
            </p>
          )}
          {isMember && (
            <p className="text-[12.5px] mb-7 leading-relaxed" style={{ color: "var(--w3)" }}>
              {i18n.memberBodySub}
            </p>
          )}

          {redeeming ? (
            <div className="flex justify-center py-4">
              <Spinner size="md" />
            </div>
          ) : error ? (
            <p className="text-[13px] mb-4 px-4 py-3 rounded-xl"
              style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
              {error}
            </p>
          ) : (
            <div className="space-y-3">
              <button onClick={() => goTo("register")}
                className="w-full py-3.5 text-[14.5px] font-bold rounded-2xl transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98]"
                style={{ background: "var(--gold)", color: "#131312", boxShadow: "0 4px 18px var(--border-gold)" }}>
                {isMember ? i18n.ctaMember : i18n.ctaCandidate}
              </button>
              <button onClick={() => goTo("login")}
                className="w-full py-3 text-[13px] font-medium rounded-2xl transition-opacity hover:opacity-80"
                style={{ background: "transparent", color: "var(--w3)", border: "1px solid var(--border)" }}>
                {i18n.alreadyHaveAccount}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11.5px] mt-5" style={{ color: "var(--w3)" }}>
          {i18n.termsPrefix}{" "}
          <a href="/portal/terms" style={{ color: "var(--w3)", textDecoration: "underline" }}>{i18n.termsLink}</a>
        </p>
      </div>
    </main>
  );
}
