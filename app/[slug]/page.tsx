"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useLang } from "@/components/LangContext";
import { natToLang } from "@/lib/countries";
import { RESERVED_SLUGS } from "@/lib/profile-slug";
import { supabase } from "@/lib/supabase";

type ProfileResp = {
  slug: string;
  name: string;
  initial: string;
  photoUrl: string | null;
  cityOfResidence: string | null;
  countryOfResidence: string | null;
  nationality: string | null;
  verified: boolean;
  isAdmin?: boolean;
};

export default function PublicProfilePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const { lang } = useLang();

  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Viewer-side gating for the "Message" button on the admin profile.
  const [viewerStatus, setViewerStatus] = useState<{ authenticated: boolean; verified: boolean; isAdmin: boolean } | null>(null);
  // Popup state for the Message CTA — explains what's needed before DMing.
  const [popup, setPopup] = useState<null | "register" | "verify">(null);

  // Reserved-path guard — without this, /[slug] would swallow /portal etc.
  useEffect(() => {
    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
      notFound();
    }
  }, [slug]);

  // Look up viewer status for the Message button on every profile.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      try {
        const res = await fetch("/api/portal/me/verified", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setViewerStatus(j);
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, [profile]);

  useEffect(() => {
    if (RESERVED_SLUGS.has(slug.toLowerCase())) return;
    let cancelled = false;
    fetch(`/api/p/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error ?? "not_found");
          return;
        }
        const j = await r.json();
        if (!cancelled) setProfile(j);
      })
      .catch(() => { if (!cancelled) setError("network"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // Resolve any stored country value (ISO code like MAR/DEU, or a name in
  // any language, or a legacy adjective) into the country name in the
  // viewer's UI language. Never let a 3-letter code leak through.
  function localizeCountry(value: string | null): string | null {
    if (!value) return null;
    const out = natToLang(value, lang as "fr" | "en" | "de");
    return out || null;
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
        <div className="text-center text-sm" style={{ color: "var(--w3)" }}>…</div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pt-[72px]" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-[420px] text-center px-8 py-10"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)" }}>
          <h1 className="text-[18px] font-semibold mb-2" style={{ color: "var(--w)" }}>
            {lang === "de" ? "Profil nicht gefunden" : lang === "en" ? "Profile not found" : "Profil introuvable"}
          </h1>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--w3)" }}>
            {lang === "de"
              ? "Dieses Profil existiert nicht oder wurde noch nicht freigegeben."
              : lang === "en"
                ? "This profile doesn't exist or hasn't been verified yet."
                : "Ce profil n'existe pas ou n'a pas encore été validé."}
          </p>
        </div>
      </main>
    );
  }

  const livesIn = profile.cityOfResidence
    ? [profile.cityOfResidence, localizeCountry(profile.countryOfResidence)].filter(Boolean).join(", ")
    : localizeCountry(profile.countryOfResidence);

  return (
    <main className="bv-page-bottom min-h-screen flex items-start justify-center px-4 pt-[88px]" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-[460px]">
        <div className="px-8 py-10 text-center"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)" }}>

          {/* Avatar — photo from CV builder if uploaded, otherwise initial */}
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoUrl} alt={profile.name}
              className="mx-auto w-24 h-24 rounded-full object-cover mb-5"
              style={{ border: "1px solid var(--border)" }} />
          ) : (
            <div className="mx-auto w-24 h-24 rounded-full flex items-center justify-center text-[36px] font-semibold mb-5"
              style={{ background: "var(--gdim)", color: "var(--gold)" }}>
              {profile.initial}
            </div>
          )}

          {/* Name dead-center; badge sits to the right via absolute positioning
              so it never shifts the name off-center. */}
          <div className="relative inline-block mb-1">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em]" style={{ color: "var(--w)" }}>
              {profile.name}
            </h1>
            {profile.verified && (
              <span className="absolute" style={{ left: "100%", top: "50%", transform: "translateY(-50%)" }}>
                <VerifiedBadge verified size="md" isAdmin={profile.isAdmin} color={profile.isAdmin ? "black" : "gold"}
                  name={profile.name}
                  title={lang === "de" ? "Verifiziert von Borivon" : lang === "en" ? "Verified by Borivon" : "Vérifié par Borivon"} />
              </span>
            )}
          </div>

          {livesIn && (
            <p className="text-[13.5px] mb-6" style={{ color: "var(--w3)" }}>
              {lang === "de" ? "wohnhaft in " : lang === "en" ? "lives in " : "vit à "}
              <span style={{ color: "var(--w2)" }}>{livesIn}</span>
            </p>
          )}

          {/* Verification badge — always centered on its own row so it never
              collides with the name. */}
          {profile.isAdmin ? null : profile.verified ? (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full"
                style={{ background: "var(--bg2)", color: "var(--w3)" }}>
                <span className="font-[family-name:var(--font-dm-serif)] italic"
                  style={{ color: "var(--w2)" }}>Borivon<span style={{ color: "var(--gold)" }}>.</span></span>
                ·
                <span>{lang === "de" ? "Verifiziertes Profil" : lang === "en" ? "Verified profile" : "Profil vérifié"}</span>
              </span>
            </div>
          ) : (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full"
                  style={{ background: "var(--danger-border)" }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
                {lang === "de" ? "Nicht verifiziert" : lang === "en" ? "Not verified" : "Non vérifié"}
              </span>
            </div>
          )}

          {/* Message button — admin profile only. Candidate profiles do not
              have a Message button (would let candidates DM each other or
              themselves, which isn't a flow we support). */}
          {profile.isAdmin && !viewerStatus?.isAdmin && (
            <div className="mt-6">
              <button
                onClick={() => {
                  if (!viewerStatus?.authenticated) { setPopup("register"); return; }
                  if (!viewerStatus.verified)       { setPopup("verify");   return; }
                  router.push("/portal/dashboard");
                }}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-sm)" }}>
                {lang === "de" ? "Nachricht" : lang === "en" ? "Message" : "Message"}
              </button>
            </div>
          )}

        </div>

        {/* URL footer hidden by request — will return later. */}
      </div>

      {/* ── Message-CTA popups ───────────────────────────────────────────── */}
      {popup && (
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[800] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setPopup(null)}>
          <div className="w-full max-w-[400px] p-6 text-center overflow-y-auto"
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)",
                     maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}
            onClick={e => e.stopPropagation()}>
            {popup === "register" ? (
              <>
                <p className="text-[15px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
                  {lang === "de" ? "Konto erforderlich" : lang === "en" ? "Account required" : "Compte requis"}
                </p>
                <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "Erstellen Sie ein Konto, um Youness Taoufiq zu schreiben."
                  : lang === "en" ? "Create an account to message Youness Taoufiq."
                  : "Créez un compte pour écrire à Youness Taoufiq."}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setPopup(null)}
                    className="px-4 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: "transparent", color: "var(--w3)" }}>
                    {lang === "de" ? "Schließen" : lang === "en" ? "Close" : "Fermer"}
                  </button>
                  <button onClick={() => { setPopup(null); router.push("/portal"); }}
                    className="px-4 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    {lang === "de" ? "Zum Portal" : lang === "en" ? "Go to portal" : "Accéder au portail"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[15px] font-semibold tracking-tight mb-2" style={{ color: "var(--w)" }}>
                  {lang === "de" ? "Profil noch nicht verifiziert" : lang === "en" ? "Profile not verified yet" : "Profil non encore vérifié"}
                </p>
                <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "Laden Sie zuerst Ihren Reisepass hoch und erstellen Sie Ihren Lebenslauf — beide müssen genehmigt sein, bevor Sie Youness Taoufiq direkt anschreiben können."
                  : lang === "en" ? "Upload your passport and create your CV — both must be approved before you can message Youness Taoufiq directly."
                  : "Téléversez votre passeport et créez votre CV — les deux doivent être approuvés avant de pouvoir écrire directement à Youness Taoufiq."}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setPopup(null)}
                    className="px-4 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: "transparent", color: "var(--w3)" }}>
                    {lang === "de" ? "Schließen" : lang === "en" ? "Close" : "Fermer"}
                  </button>
                  <button onClick={() => { setPopup(null); router.push("/portal/dashboard"); }}
                    className="px-4 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    {lang === "de" ? "Zum Dashboard" : lang === "en" ? "Go to dashboard" : "Aller au tableau de bord"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
