"use client";

/**
 * In-app profile popup — same data + look as the public `/[slug]` page,
 * but rendered as a modal so clicking a profile inside the website never
 * navigates the user away.
 *
 * The public `/[slug]` route still exists for direct/shared URLs (SEO,
 * sharing the link with others). This component only replaces the
 * IN-APP click flow.
 *
 * Usage:
 *   <ProfilePopup slug="saad76631" onClose={() => ...} />
 *
 * Anyone calling this from a click handler should be inside a portal page
 * (otherwise the access token / verified-state lookup is skipped — anonymous
 * mode is supported but the dashboard button won't show).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X as XIcon } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useLang } from "@/components/LangContext";
import { natToLang } from "@/lib/countries";
import { Skeleton } from "@/components/ui/states";

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

export function ProfilePopup({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { lang, t: gT } = useLang();
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Fetch profile
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/p/${encodeURIComponent(slug)}`)
      .then(async r => {
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

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Resolve any stored country value (ISO code, name in any language, or
  // legacy adjective) into the country name in the viewer's UI language.
  function localizeCountry(value: string | null): string | null {
    if (!value) return null;
    const out = natToLang(value, lang as "fr" | "en" | "de");
    return out || null;
  }

  if (typeof document === "undefined") return null;

  const livesIn = profile?.cityOfResidence
    ? [profile.cityOfResidence, localizeCountry(profile.countryOfResidence)].filter(Boolean).join(", ")
    : localizeCountry(profile?.countryOfResidence ?? null);

  const node = (
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 bv-profile-popup-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)",
               animation: "bvFadeRise .22s var(--ease-out)",
               overflowY: "auto" }}
      onClick={onClose}>
      {/* Mobile clearance for the bottom action bar.
          Outer overlay owns the scroll (LAW #36: scroll only when the
          content can't fit). The card itself never clips so the floating
          X button + rounded corners are always fully visible. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-profile-popup-outer { padding-bottom: calc(1rem + 72px) !important; }
        }
      `}</style>
      <div className="w-full max-w-[460px] relative my-auto"
        onClick={e => e.stopPropagation()}
        style={{ animation: "bvFadeRise .28s var(--ease-out)" }}>

        {/* Close button — floats top-right of the card */}
        <button onClick={onClose} aria-label={gT.miClose}
          className="absolute -top-2 -right-2 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-90"
          style={{ background: "var(--card)", color: "var(--w2)",
                   border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}>
          <XIcon size={14} strokeWidth={1.8} />
        </button>

        {loading ? (
          // Skeleton state
          <div className="px-8 py-10 text-center"
            style={{ background: "var(--card)", borderRadius: "20px",
                     boxShadow: "var(--shadow-lg)" }}>
            <Skeleton className="mx-auto w-24 h-24 mb-5" style={{ borderRadius: "9999px" }} />
            <Skeleton className="mx-auto block w-44 h-5 mb-3" />
            <Skeleton className="mx-auto block w-32 h-6 mt-3" style={{ borderRadius: "9999px" }} />
          </div>
        ) : error || !profile ? (
          <div className="px-8 py-10 text-center"
            style={{ background: "var(--card)", borderRadius: "20px",
                     boxShadow: "var(--shadow-lg)" }}>
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
        ) : (
          <div className="px-8 py-10 text-center"
            style={{ background: "var(--card)", borderRadius: "20px",
                     boxShadow: "var(--shadow-lg)" }}>

            {/* Avatar — photo if set, otherwise initial */}
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

          </div>
        )}

        {/* URL footer hidden by request — will return later. */}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
