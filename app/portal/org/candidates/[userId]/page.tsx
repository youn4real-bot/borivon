"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { PageLoader } from "@/components/ui/states";
import {
  ArrowLeft, CheckCircle2, Clock, FileText,
  MessageCircle, Star, ShieldCheck, AlertCircle,
} from "lucide-react";

// ── Translations ──────────────────────────────────────────────────────────────
const T_MAP = {
  en: {
    back:          "Our candidates",
    verifiedLabel: "Identity verified",
    pendingLabel:  "Verification in progress",
    tierStarter:   "Starter",
    tierKandidat:  "Kandidat",
    docsTitle:     "Documents",
    docsApproved:  "Approved",
    docsPending:   "Pending review",
    docsTotal:     "Total submitted",
    statusTitle:   "Profile status",
    passportOk:    "Passport data submitted",
    passportNone:  "Passport data missing",
    cvReady:       "CV / Dossier ready",
    cvMissing:     "CV not yet built",
    contactBtn:    "Send message",
    allDone:       "All documents approved",
    inReview:      "Documents under review",
    noDocsYet:     "No documents yet",
  },
  fr: {
    back:          "Nos candidats",
    verifiedLabel: "Identité vérifiée",
    pendingLabel:  "Vérification en cours",
    tierStarter:   "Starter",
    tierKandidat:  "Kandidat",
    docsTitle:     "Documents",
    docsApproved:  "Approuvés",
    docsPending:   "En attente",
    docsTotal:     "Total soumis",
    statusTitle:   "Statut du profil",
    passportOk:    "Données passeport soumises",
    passportNone:  "Données passeport manquantes",
    cvReady:       "CV / Dossier prêt",
    cvMissing:     "CV non encore créé",
    contactBtn:    "Envoyer un message",
    allDone:       "Tous les documents approuvés",
    inReview:      "Documents en cours d'examen",
    noDocsYet:     "Aucun document encore",
  },
  de: {
    back:          "Unsere Kandidaten",
    verifiedLabel: "Identität verifiziert",
    pendingLabel:  "Verifizierung läuft",
    tierStarter:   "Starter",
    tierKandidat:  "Kandidat",
    docsTitle:     "Dokumente",
    docsApproved:  "Genehmigt",
    docsPending:   "Ausstehend",
    docsTotal:     "Insgesamt eingereicht",
    statusTitle:   "Profilstatus",
    passportOk:    "Passdaten eingereicht",
    passportNone:  "Passdaten fehlen",
    cvReady:       "Lebenslauf / Dossier bereit",
    cvMissing:     "Lebenslauf noch nicht erstellt",
    contactBtn:    "Nachricht senden",
    allDone:       "Alle Dokumente genehmigt",
    inReview:      "Dokumente werden geprüft",
    noDocsYet:     "Noch keine Dokumente",
  },
} as const;
type Lang = keyof typeof T_MAP;

type Dossier = {
  candidateId: string;
  name: string;
  email: string;
  photo: string | null;
  verified: boolean;
  tier: string | null;
  passportStatus: string | null;
  hasCvDraft: boolean;
  docCount: number;
  docsOk: number;
  docsPending: number;
  linkStatus: string;
};

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier, label }: { tier: string | null; label: string }) {
  if (!tier || tier === "free") return null;
  const isKandidat = tier === "kandidat";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full"
      style={isKandidat
        ? { background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }
        : { background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }
      }
    >
      {isKandidat && <Star size={8} strokeWidth={2.5} style={{ fill: "var(--gold)", stroke: "var(--gold)" }} />}
      {label}
    </span>
  );
}

// ── Doc progress bar ──────────────────────────────────────────────────────────
function DocBar({ ok, pending, total }: { ok: number; pending: number; total: number }) {
  if (total === 0) return null;
  const pctOk      = Math.round((ok / total) * 100);
  const pctPending = Math.round((pending / total) * 100);
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden flex" style={{ background: "var(--bg2)" }}>
      <div className="h-full transition-all duration-700" style={{ width: `${pctOk}%`, background: "var(--success)" }} />
      <div className="h-full transition-all duration-700" style={{ width: `${pctPending}%`, background: "var(--gold)" }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OrgCandidateDossierPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  const { lang } = useLang();
  const router = useRouter();
  const T = T_MAP[(lang as Lang) in T_MAP ? (lang as Lang) : "en"];

  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/"); return; }

      const res = await fetch(`/api/portal/org/candidates/${userId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? "Error");
        setLoading(false);
        return;
      }
      const data = await res.json() as Dossier;
      setDossier(data);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, router]);

  if (loading) return <PageLoader />;

  if (error || !dossier) {
    return (
      <>
        <PortalTopNav />
        <main className="px-4 sm:px-[3.5vw] py-6 max-w-2xl mx-auto">
          <p className="text-[13px]" style={{ color: "var(--w3)" }}>{error || "Not found"}</p>
        </main>
      </>
    );
  }

  const initials  = dossier.name.charAt(0).toUpperCase();
  const allOk     = dossier.docCount > 0 && dossier.docsOk === dossier.docCount;
  const someReview = dossier.docsPending > 0;
  const docStatus = allOk ? "ok" : someReview ? "review" : dossier.docCount > 0 ? "review" : "none";

  return (
    <>
      <PortalTopNav />

      <main className="px-4 sm:px-[3.5vw] py-6 max-w-2xl mx-auto space-y-4">

        {/* Back button */}
        <button
          onClick={() => router.push("/portal/org/dashboard")}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-opacity hover:opacity-70"
          style={{ color: "var(--w3)" }}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {T.back}
        </button>

        {/* ── Hero card ── */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {/* Gold gradient top strip */}
          <div
            className="h-[72px] w-full"
            style={{
              background: "linear-gradient(135deg, var(--gdim) 0%, var(--gdim) 100%)",
              borderBottom: "1px solid var(--border-gold)",
            }}
          />

          <div className="px-6 pb-6">
            {/* Avatar — overlaps the strip */}
            <div className="relative -mt-10 mb-3 inline-block">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden"
                style={{
                  background: "var(--gdim)",
                  border: "3px solid var(--border-gold)",
                  boxShadow: "0 0 0 4px var(--bg)",
                }}
              >
                {dossier.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={dossier.photo} alt={dossier.name} className="w-full h-full object-cover" />
                  : <span className="text-[28px] font-bold" style={{ color: "var(--gold)" }}>{initials}</span>
                }
              </div>
            </div>

            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {dossier.name}
              </h1>
              {dossier.verified && <VerifiedBadge verified={true} size="sm" color="gold" />}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <TierBadge
                tier={dossier.tier}
                label={dossier.tier === "kandidat" ? T.tierKandidat : T.tierStarter}
              />
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium"
                style={{ color: dossier.verified ? "var(--success)" : "var(--w3)" }}
              >
                {dossier.verified
                  ? <><CheckCircle2 size={11} strokeWidth={2} />{T.verifiedLabel}</>
                  : <><Clock size={11} strokeWidth={2} />{T.pendingLabel}</>
                }
              </span>
            </div>

            {/* Contact button */}
            <button
              onClick={() => window.dispatchEvent(
                new CustomEvent("bv:open-chat", { detail: { email: dossier.email } })
              )}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-85 active:scale-[0.97]"
              style={{
                background: "var(--gold)",
                color: "#131312",
              }}
            >
              <MessageCircle size={14} strokeWidth={2} />
              {T.contactBtn}
            </button>
          </div>
        </div>

        {/* ── Documents card ── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <FileText size={14} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
            <h2 className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>{T.docsTitle}</h2>
            {docStatus === "ok" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                {T.allDone}
              </span>
            )}
            {docStatus === "review" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                {T.inReview}
              </span>
            )}
          </div>

          {dossier.docCount === 0 ? (
            <p className="text-[12.5px]" style={{ color: "var(--w3)" }}>{T.noDocsYet}</p>
          ) : (
            <div className="space-y-3">
              <DocBar ok={dossier.docsOk} pending={dossier.docsPending} total={dossier.docCount} />
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: T.docsApproved, value: dossier.docsOk,      color: "var(--success)" },
                  { label: T.docsPending,  value: dossier.docsPending, color: "var(--gold)"    },
                  { label: T.docsTotal,    value: dossier.docCount,    color: "var(--w2)"      },
                ].map(({ label, value, color }) => (
                  <div key={label}
                    className="rounded-xl p-3 text-center"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <p className="text-[20px] font-bold" style={{ color }}>{value}</p>
                    <p className="text-[10.5px] mt-0.5" style={{ color: "var(--w3)" }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Profile status card ── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={14} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
            <h2 className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>{T.statusTitle}</h2>
          </div>
          <div className="space-y-2.5">
            {[
              {
                ok:    dossier.passportStatus === "approved",
                label: dossier.passportStatus === "approved" ? T.passportOk : T.passportNone,
              },
              {
                ok:    dossier.hasCvDraft,
                label: dossier.hasCvDraft ? T.cvReady : T.cvMissing,
              },
            ].map(({ ok, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                {ok
                  ? <CheckCircle2 size={15} strokeWidth={2} style={{ color: "var(--success)", flexShrink: 0 }} />
                  : <AlertCircle  size={15} strokeWidth={2} style={{ color: "var(--w3)",     flexShrink: 0 }} />
                }
                <span className="text-[12.5px]" style={{ color: ok ? "var(--w)" : "var(--w3)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

      </main>
    </>
  );
}
