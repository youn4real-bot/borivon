"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { PageLoader } from "@/components/ui/states";
import { MessageCircle, AlertCircle } from "lucide-react";
import { JourneyChecklist } from "@/components/JourneyChecklist";
import { BackLink, Btn, Card, Dot, Empty, KitStyle, STATUS_DOT } from "@/components/fx/kit";

// ── Translations ──────────────────────────────────────────────────────────────
const T_MAP = {
  en: {
    back:          "Our candidates",
    verifiedLabel: "Identity verified",
    pendingLabel:  "Verification in progress",
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
    notFound:      "Not found",
  },
  fr: {
    back:          "Nos candidats",
    verifiedLabel: "Identité vérifiée",
    pendingLabel:  "Vérification en cours",
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
    notFound:      "Introuvable",
  },
  de: {
    back:          "Unsere Kandidaten",
    verifiedLabel: "Identität verifiziert",
    pendingLabel:  "Verifizierung läuft",
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
    notFound:      "Nicht gefunden",
  },
} as const;
type Lang = keyof typeof T_MAP;

type Dossier = {
  candidateId: string;
  name: string;
  email: string;
  photo: string | null;
  verified: boolean;
  passportStatus: string | null;
  hasCvDraft: boolean;
  docCount: number;
  docsOk: number;
  docsPending: number;
  linkStatus: string;
};

// ── Doc progress bar (the one status palette: green done · orange waiting) ──
function DocBar({ ok, pending, total }: { ok: number; pending: number; total: number }) {
  if (total === 0) return null;
  const pctOk      = Math.round((ok / total) * 100);
  const pctPending = Math.round((pending / total) * 100);
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 999, overflow: "hidden", display: "flex", background: "var(--bg2)" }}>
      <div className="transition-all duration-700" style={{ height: "100%", width: `${pctOk}%`, background: STATUS_DOT.approved }} />
      <div className="transition-all duration-700" style={{ height: "100%", width: `${pctPending}%`, background: STATUS_DOT.pending }} />
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

      // Redirect to the supreme-admin candidate panel (org admins are
      // sub_admins server-side, so they have permission to use the same
      // doc-review UI as the supreme admin). Keeps a single source of
      // truth for the candidate dashboard layout.
      const res = await fetch(`/api/portal/org/candidates/${userId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json() as Dossier;
        if (!cancelled) {
          router.replace(`/portal/admin?nav_email=${encodeURIComponent(data.email)}`);
          return;
        }
      }
      // Fallback — keep showing the summary view if we can't resolve email
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
        <main className="mx-auto w-full px-4" style={{ maxWidth: 720, paddingTop: 90, paddingBottom: 32 }}>
          <KitStyle />
          <Card><Empty icon={<AlertCircle size={22} strokeWidth={1.5} />}>{error || T.notFound}</Empty></Card>
        </main>
      </>
    );
  }

  const initials  = dossier.name.charAt(0).toUpperCase();
  const allOk     = dossier.docCount > 0 && dossier.docsOk === dossier.docCount;
  const someReview = dossier.docsPending > 0;
  const docStatus = allOk ? "ok" : someReview ? "review" : dossier.docCount > 0 ? "review" : "none";

  // the one design (founder 2026-11-13): quiet back, photo + serif name + ONE black button,
  // colour = status (dots), the numbers big in serif, paper cards
  return (
    <>
      <PortalTopNav />

      <main className="mx-auto w-full px-4" style={{ maxWidth: 1040, paddingTop: 90, paddingBottom: 40 }}>
        <KitStyle />
        <style>{CAND_CSS}</style>

        <div style={{ marginBottom: 14 }}>
          <BackLink label={T.back} onClick={() => router.push("/portal/org/dashboard")} />
        </div>

        {/* ── Head: photo, name, verified line, one black button ── */}
        <div className="bvk-head">
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden", flex: "none", display: "grid", placeItems: "center", background: "var(--bg2)" }}>
              {dossier.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={dossier.photo} alt={dossier.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontFamily: "var(--font-serif)", fontSize: 28, lineHeight: 1, color: "var(--w3)" }}>{initials}</span>
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={{ overflowWrap: "anywhere" }}>{dossier.name}</span>
                {dossier.verified && <VerifiedBadge verified={true} size="sm" color="gold" />}
              </h1>
              <div className="bvk-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot st={dossier.verified ? "approved" : "pending"} size={7} />
                {dossier.verified ? T.verifiedLabel : T.pendingLabel}
              </div>
            </div>
          </div>
          <div className="bvk-act">
            {/* Contact button */}
            <Btn kind="primary"
              onClick={() => window.dispatchEvent(
                new CustomEvent("bv:open-chat", { detail: { email: dossier.email } })
              )}>
              <MessageCircle size={15} strokeWidth={1.8} />
              {T.contactBtn}
            </Btn>
          </div>
        </div>

        {/* ── Laptop: documents + profile status on the left, the journey on the right (fits one screen);
             phone: one column ── */}
        <div className="bvc-wrap">
        <div className="bvc-side">
          <Card style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px 12px", marginBottom: 14 }}>
              <h2 style={H2}>{T.docsTitle}</h2>
              {docStatus === "ok" && <span style={STATE}><Dot st="approved" size={7} />{T.allDone}</span>}
              {docStatus === "review" && <span style={STATE}><Dot st="pending" size={7} />{T.inReview}</span>}
            </div>

            {dossier.docCount === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--w3)" }}>{T.noDocsYet}</p>
            ) : (
              <>
                <DocBar ok={dossier.docsOk} pending={dossier.docsPending} total={dossier.docCount} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginTop: 14 }}>
                  {[
                    { label: T.docsApproved, value: dossier.docsOk,      st: "approved" as const },
                    { label: T.docsPending,  value: dossier.docsPending, st: "pending" as const  },
                    { label: T.docsTotal,    value: dossier.docCount,    st: null                },
                  ].map(({ label, value, st }) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w3)" }}>
                      {st && <Dot st={st} />}
                      <b style={NUM}>{value}</b>{label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card style={{ padding: "18px 20px" }}>
            <h2 style={{ ...H2, marginBottom: 14 }}>{T.statusTitle}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: ok ? "var(--w)" : "var(--w3)" }}>
                  <Dot st={ok ? "approved" : "missing"} />
                  {label}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── Journey card ── (cross-party milestones; org sees full list +
             can tick Organization items + add custom — scoped server-side) */}
        <Card style={{ padding: "18px 20px" }}>
          <h2 style={{ ...H2, marginBottom: 14 }}>
            {lang === "de" ? "Verlauf" : lang === "fr" ? "Parcours" : "Journey"}
          </h2>
          <JourneyChecklist candidateUserId={userId} />
        </Card>
        </div>

      </main>
    </>
  );
}

// ── the one design: small pieces of this page ─────────────────────────────────
const H2: React.CSSProperties = { margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: "var(--w)" };
const NUM: React.CSSProperties = { fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1, color: "var(--w)" };
const STATE: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--w2)", whiteSpace: "nowrap" };
const CAND_CSS = `.bvc-wrap{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:12px;align-items:start}
.bvc-side{display:flex;flex-direction:column;gap:12px;min-width:0}
@media (max-width:900px){.bvc-wrap{grid-template-columns:minmax(0,1fr)}}`;
