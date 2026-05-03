"use client";

/**
 * Organization invite-code modal.
 *
 * Shown to candidates who don't yet have an approved organization.
 * They paste the code their recruitment partner gave them, hit Join,
 * and from that moment members of that org can see them.
 *
 * Mounted from the dashboard. The dashboard fetches /api/portal/me/organizations
 * on load — if the response is empty, it renders this modal.
 *
 * UX rules:
 *   - Backdrop is non-dismissible so candidates don't accidentally skip.
 *   - There IS a "Skip for now" button (small, low-emphasis) — but clicking
 *     it just closes the modal in this session; it'll come back next login
 *     until an org is joined.
 *   - On success, we close immediately and refresh the dashboard org state.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Building2, X as XIcon, Send } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";

const T = {
  fr: {
    title: "Rejoindre votre organisation",
    sub:   "Saisissez le code que votre partenaire vous a donné. Une fois validé, ils pourront suivre votre parcours.",
    label: "Code d'invitation",
    join:  "Rejoindre",
    skip:  "Plus tard",
    pending: "Demande envoyée — l'admin doit l'approuver.",
    invalidCode: "Code invalide. Vérifiez avec votre partenaire.",
    networkErr:  "Erreur réseau. Réessayez.",
  },
  en: {
    title: "Join your organization",
    sub:   "Paste the invite code your recruitment partner gave you. Once verified, they'll be able to support your journey.",
    label: "Invite code",
    join:  "Join",
    skip:  "Later",
    pending: "Request sent — the admin needs to approve it.",
    invalidCode: "Invalid code. Double-check with your partner.",
    networkErr:  "Network error. Please try again.",
  },
  de: {
    title: "Organisation beitreten",
    sub:   "Geben Sie den Einladungscode Ihres Partners ein. Nach Bestätigung können sie Ihren Werdegang unterstützen.",
    label: "Einladungscode",
    join:  "Beitreten",
    skip:  "Später",
    pending: "Anfrage gesendet — der Admin muss sie genehmigen.",
    invalidCode: "Ungültiger Code. Bitte mit dem Partner prüfen.",
    networkErr:  "Netzwerkfehler. Bitte erneut versuchen.",
  },
} as const;

export function OrgCodeModal({
  accessToken,
  onJoined,
  onSkip,
}: {
  accessToken: string;
  onJoined: () => void;
  onSkip: () => void;
}) {
  const { lang } = useLang();
  const t = T[(lang as "fr" | "en" | "de") in T ? (lang as "fr" | "en" | "de") : "en"];

  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState<{ name: string; status: string } | null>(null);

  async function submit() {
    if (loading || !code.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/portal/me/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error === "Invalid code" ? t.invalidCode : t.networkErr);
        return;
      }
      setSuccess({ name: json.org?.name ?? "", status: json.status });
      // Approved → close immediately. Pending → show 'pending' message for 1.5s.
      if (json.status === "approved") {
        setTimeout(() => onJoined(), 600);
      } else {
        setTimeout(() => onJoined(), 1800);
      }
    } catch {
      setError(t.networkErr);
    } finally {
      setLoading(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-center justify-center p-4 bv-org-modal-outer"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
               animation: "bvFadeRise 0.32s var(--ease-out)" }}>
      {/* Reserve space for the mobile bottom action bar so the modal never
          slides behind the language/theme/profile cluster on small screens. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-org-modal-outer { padding-bottom: calc(1rem + 72px) !important; }
        }
      `}</style>
      <div className="w-full max-w-[440px] flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)",
                 borderRadius: "var(--r-2xl)", boxShadow: "var(--shadow-lg)",
                 paddingBottom: "env(safe-area-inset-bottom)",
                 animation: "bvFadeRise 0.36s var(--ease-out)" }}>

        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-full mx-auto mb-4"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            <Building2 size={18} strokeWidth={1.7} />
          </div>
          <h2 className="text-[17px] font-semibold tracking-tight text-center mb-1.5" style={{ color: "var(--w)" }}>
            {t.title}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-center mb-5 px-2" style={{ color: "var(--w3)" }}>
            {t.sub}
          </p>

          {success ? (
            <div className="text-center py-3">
              <p className="text-[14px] font-semibold" style={{ color: success.status === "approved" ? "var(--success)" : "var(--gold)" }}>
                ✓ {success.name}
              </p>
              {success.status === "pending" && (
                <p className="text-[11.5px] mt-2" style={{ color: "var(--w3)" }}>{t.pending}</p>
              )}
            </div>
          ) : (
            <>
              <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>
                {t.label}
              </label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && submit()}
                placeholder="ABC123XY"
                autoFocus
                className="w-full px-3 py-3 text-[15px] font-mono font-semibold tracking-[0.2em] text-center uppercase outline-none transition-colors focus:border-[var(--gold)]"
                style={{ background: "var(--bg2)", color: "var(--w)",
                         border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}
              />
              {error && (
                <p className="mt-2 text-[11.5px] text-center" style={{ color: "var(--danger)" }}>{error}</p>
              )}
            </>
          )}
        </div>

        {!success && (
          <div className="flex items-center gap-2 px-6 pb-5">
            <button onClick={onSkip} disabled={loading}
              className="text-[12.5px] font-medium px-4 py-2.5 transition-colors disabled:opacity-50"
              style={{ background: "transparent", color: "var(--w3)" }}>
              {t.skip}
            </button>
            <button onClick={submit} disabled={loading || !code.trim()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold py-2.5 transition-opacity disabled:opacity-40"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)" }}>
              {loading ? <Spinner size="xs" color="#131312" /> : <Send size={12} strokeWidth={2} />}
              {t.join}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
