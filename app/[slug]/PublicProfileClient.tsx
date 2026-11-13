"use client";

import { Wordmark } from "@/components/Wordmark";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { SHOW_CANDIDATE_TICK } from "@/lib/features";
import { useLang } from "@/components/LangContext";
import { natToLang } from "@/lib/countries";
import { supabase } from "@/lib/supabase";
import { KitStyle, Card, Btn } from "@/components/fx/kit";

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

/**
 * The rendered profile. Split out of page.tsx so that page.tsx can be a SERVER
 * component: only a server component can answer 404 with a real 404 status.
 * The slug arrives as a prop from there, already checked for the one shape a
 * profile URL can have — this file no longer has to guess whether it was even
 * handed a profile address.
 */
export default function PublicProfileClient({ slug }: { slug: string }) {
  const { lang } = useLang();

  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Viewer-side gating for the "Message" button on the admin profile.
  const [viewerStatus, setViewerStatus] = useState<{ authenticated: boolean; verified: boolean; isAdmin: boolean } | null>(null);
  // Popup state for the Message CTA — explains what's needed before DMing.
  const [popup, setPopup] = useState<null | "register" | "verify">(null);

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
        <KitStyle />
        <Card className="w-full max-w-[420px] text-center" style={{ padding: "36px 28px" }}>
          <h1 style={{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 28, lineHeight: 1.15, color: "var(--w)" }}>
            {lang === "de" ? "Profil nicht gefunden" : lang === "en" ? "Profile not found" : "Profil introuvable"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--w3)" }}>
            {lang === "de"
              ? "Dieses Profil existiert nicht oder wurde noch nicht freigegeben."
              : lang === "en"
                ? "This profile doesn't exist or hasn't been verified yet."
                : "Ce profil n'existe pas ou n'a pas encore été validé."}
          </p>
        </Card>
      </main>
    );
  }

  const livesIn = profile.cityOfResidence
    ? [profile.cityOfResidence, localizeCountry(profile.countryOfResidence)].filter(Boolean).join(", ")
    : localizeCountry(profile.countryOfResidence);

  return (
    <main className="bv-page-bottom min-h-screen flex items-start justify-center px-4 pt-[88px]" style={{ background: "var(--bg)" }}>
      <KitStyle />
      {/* the one design (founder 2026-11-13, components/fx/kit): paper card with a hairline, the photo as on
          her Profil card (portrait, radius 14), serif name, black pill */}
      <div className="w-full max-w-[460px]">
        <Card className="text-center" style={{ padding: "36px 28px 32px" }}>

          {/* Avatar — photo from CV builder if uploaded, otherwise initial */}
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoUrl} alt={profile.name}
              style={{ display: "block", width: 112, height: 134, margin: "0 auto 20px", borderRadius: 14, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 112, height: 134, margin: "0 auto 20px", borderRadius: 14, background: "var(--bg2)", display: "grid", placeItems: "center",
              fontFamily: "var(--font-serif)", fontSize: 44, lineHeight: 1, color: "var(--w3)" }}>
              {profile.initial}
            </div>
          )}

          {/* Name dead-center; badge sits to the right via absolute positioning
              so it never shifts the name off-center. */}
          <div className="relative inline-block" style={{ marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 30, lineHeight: 1.15, letterSpacing: "-.01em", color: "var(--w)", overflowWrap: "anywhere" }}>
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
            <p style={{ margin: 0, fontSize: 14, color: "var(--w3)" }}>
              {lang === "de" ? "wohnhaft in " : lang === "en" ? "lives in " : "vit à "}
              <span style={{ color: "var(--w2)" }}>{livesIn}</span>
            </p>
          )}

          {/* Verification badge — always centered on its own row so it never
              collides with the name. */}
          {(profile.isAdmin || !SHOW_CANDIDATE_TICK) ? null : profile.verified ? (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full"
                style={{ background: "var(--bg2)", color: "var(--w3)" }}>
                <Wordmark size="1.1em" color="var(--w2)" />
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
            <div style={{ marginTop: 22 }}>
              <Btn kind="primary"
                onClick={() => {
                  if (!viewerStatus?.authenticated) { setPopup("register"); return; }
                  if (!viewerStatus.verified)       { setPopup("verify");   return; }
                  router.push("/portal/dashboard");
                }}
                style={{ minWidth: 160 }}>
                {lang === "de" ? "Nachricht" : lang === "en" ? "Message" : "Message"}
              </Btn>
            </div>
          )}

        </Card>

        {/* URL footer hidden by request — will return later. */}
      </div>

      {/* ── Message-CTA popups (LAW #36: z 1100, blur 8, radius 20) ──────── */}
      {popup && (
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={() => setPopup(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[400px] text-center overflow-y-auto"
            style={{ padding: 24, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "var(--shadow-lg)",
                     maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)", animation: "bvFadeRise .28s var(--ease-out)" }}
            onClick={e => e.stopPropagation()}>
            {popup === "register" ? (
              <>
                <h3 style={{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.2, color: "var(--w)" }}>
                  {lang === "de" ? "Konto erforderlich" : lang === "en" ? "Account required" : "Compte requis"}
                </h3>
                <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.55, color: "var(--w3)" }}>
                  {lang === "de" ? "Erstellen Sie ein Konto, um Youness Taoufiq zu schreiben."
                  : lang === "en" ? "Create an account to message Youness Taoufiq."
                  : "Créez un compte pour écrire à Youness Taoufiq."}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn kind="ghost" onClick={() => setPopup(null)} style={{ flex: 1 }}>
                    {lang === "de" ? "Schließen" : lang === "en" ? "Close" : "Fermer"}
                  </Btn>
                  <Btn kind="primary" onClick={() => { setPopup(null); router.push("/portal"); }} style={{ flex: 1 }}>
                    {lang === "de" ? "Zum Portal" : lang === "en" ? "Go to portal" : "Accéder au portail"}
                  </Btn>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.2, color: "var(--w)" }}>
                  {lang === "de" ? "Profil noch nicht verifiziert" : lang === "en" ? "Profile not verified yet" : "Profil non encore vérifié"}
                </h3>
                <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.55, color: "var(--w3)" }}>
                  {lang === "de" ? "Laden Sie zuerst Ihren Reisepass hoch und erstellen Sie Ihren Lebenslauf — beide müssen genehmigt sein, bevor Sie Youness Taoufiq direkt anschreiben können."
                  : lang === "en" ? "Upload your passport and create your CV — both must be approved before you can message Youness Taoufiq directly."
                  : "Téléversez votre passeport et créez votre CV — les deux doivent être approuvés avant de pouvoir écrire directement à Youness Taoufiq."}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn kind="ghost" onClick={() => setPopup(null)} style={{ flex: 1 }}>
                    {lang === "de" ? "Schließen" : lang === "en" ? "Close" : "Fermer"}
                  </Btn>
                  <Btn kind="primary" onClick={() => { setPopup(null); router.push("/portal/dashboard"); }} style={{ flex: 1 }}>
                    {lang === "de" ? "Zum Dashboard" : lang === "en" ? "Go to dashboard" : "Aller au tableau de bord"}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
