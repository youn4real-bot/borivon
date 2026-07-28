"use client";

/**
 * Admin list of homepage-funnel leads (supreme admin + sub-admins).
 * Reached from the profile-avatar menu → "Leads". Read-only.
 * Mirrors /portal/admin/online-courses.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Mail, Phone, Clock, MessageSquare, UserPlus, UserCheck, Loader2 } from "lucide-react";

type Lead = {
  id: string; kind: string; email: string; name: string; phone: string;
  message: string; details: Record<string, string> | null; created_at: string;
  /** Set once the lead has been turned into a Pool candidate. */
  candidate_user_id?: string | null;
};

// Friendly label per funnel kind (trilingual).
const KIND_LABEL: Record<string, { en: string; de: string; fr: string }> = {
  person:      { en: "Individual",      de: "Privatperson",    fr: "Particulier" },
  org:         { en: "Organisation",    de: "Organisation",    fr: "Organisation" },
  work:        { en: "Work in Germany", de: "Arbeiten in DE",  fr: "Travailler en All." },
  general:     { en: "General enquiry", de: "Allg. Anfrage",   fr: "Demande générale" },
  fachkraefte: { en: "Skilled workers", de: "Fachkräfte",      fr: "Personnel qualifié" },
  // From the public booking page (/book) — these arrive with a call already in the diary.
  nurse:       { en: "Nurse — booked",  de: "Pflegekraft — Termin", fr: "Infirmier — RDV" },
  clinic:      { en: "Clinic — booked", de: "Einrichtung — Termin", fr: "Établissement — RDV" },
  company:     { en: "Company — booked", de: "Unternehmen — Termin", fr: "Entreprise — RDV" },
};

export default function AdminLeadsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [token, setToken] = useState("");
  const [poolBusy, setPoolBusy] = useState<string | null>(null);
  const [poolErr, setPoolErr] = useState<string | null>(null);

  async function addToPool(leadId: string) {
    setPoolBusy(leadId);
    setPoolErr(null);
    try {
      const r = await fetch("/api/portal/admin/lead-to-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leadId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPoolErr(j?.error === "no_email"
          ? T("This lead has no usable email, so no account can be created yet.",
              "Diese Anfrage hat keine brauchbare E-Mail — es kann noch kein Konto angelegt werden.",
              "Cette demande n'a pas d'e-mail exploitable — aucun compte ne peut être créé.")
          : j?.error === "Supreme admin only"
            ? T("Only the main admin can do this.", "Nur der Hauptadmin kann das.", "Seul l'administrateur principal peut le faire.")
            : T("Couldn't add to the pool.", "Konnte nicht zum Pool hinzugefügt werden.", "Impossible d'ajouter au vivier."));
        return;
      }
      // Reflect it immediately — no reload needed.
      setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, candidate_user_id: j.userId } : l)));
    } catch {
      setPoolErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally {
      setPoolBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      // Fresh token (same stale-token guard as the other portal pages).
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep token */ }
        if (cancelled) return;
      }
      setToken(tk);   // kept so the "Add to pool" action can authenticate too
      const res = await fetch("/api/portal/admin/leads", { headers: { Authorization: `Bearer ${tk}` } });
      if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
      const j = await res.json().catch(() => ({ leads: [] }));
      if (cancelled) return;
      setLeads((j.leads ?? []) as Lead[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  // JWTs refresh roughly hourly — without this, the pool button 401s on a page
  // left open past the expiry.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (s?.access_token) setToken(s.access_token); });
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <PageLoader />;

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    } catch { return iso; }
  };
  const kindLabel = (k: string) => { const e = KIND_LABEL[k]; return e ? T(e.en, e.de, e.fr) : k; };

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 920 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-6">
        <h1 className="bv-h1">{T("Leads", "Anfragen", "Prospects")}</h1>
        <p className="bv-body mt-1">
          {leads.length}{" "}
          {T("enquiry(ies) from the homepage form",
             "Anfrage(n) vom Formular auf der Startseite",
             "demande(s) depuis le formulaire de la page d'accueil")}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No leads yet.", "Noch keine Anfragen.", "Aucune demande pour le moment.")}
        </div>
      ) : (
        <div className="space-y-3">
          {poolErr && (
            <p className="text-[13px] pb-1" style={{ color: "#ef4444" }} role="alert">{poolErr}</p>
          )}
          {leads.map((l) => {
            const extras = Object.entries(l.details ?? {}).filter(([, v]) => !!v);
            return (
              <div key={l.id} className="p-4 sm:p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-sm)" }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    {l.name && <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>{l.name}</p>}
                    <div className="mt-1.5 flex flex-col gap-1 text-[13px]" style={{ color: "var(--w2)" }}>
                      <span className="inline-flex items-center gap-1.5">
                        <Mail size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                        <a className="bv-link break-all" href={`mailto:${l.email}`}>{l.email}</a>
                      </span>
                      {l.phone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone size={13} style={{ color: "var(--w3)", flexShrink: 0 }} /> {l.phone}
                        </span>
                      )}
                      {l.message && (
                        <span className="inline-flex items-start gap-1.5">
                          <MessageSquare size={13} style={{ color: "var(--w3)", flexShrink: 0, marginTop: 2 }} /> {l.message}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className="bv-chip bv-chip-gold">{kindLabel(l.kind)}</span>
                    <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--w3)" }}>
                      <Clock size={12} /> {fmt(l.created_at)}
                    </span>
                    {/* The missing hop: a lead is somebody who reached out, but
                        the Pool lives in candidate_pipeline and only holds real
                        accounts — so until now every lead had to be re-created
                        by hand. One press puts them in the Pool. */}
                    {l.candidate_user_id ? (
                      <button
                        // nav_user_id, not candidate — the admin panel reads the
                        // former (page.tsx:1388) and has never read the latter,
                        // so this button dropped the founder onto the panel with
                        // nobody selected and no hint which person it meant.
                        onClick={() => router.push(`/portal/admin?nav_user_id=${l.candidate_user_id}`)}
                        className="bv-btn bv-btn-ghost bv-tap text-[12px] inline-flex items-center gap-1.5"
                      >
                        <UserCheck size={12} strokeWidth={2} style={{ color: "#16a34a" }} />
                        {T("In the pool", "Im Pool", "Dans le vivier")}
                      </button>
                    ) : l.kind === "nurse" ? (
                      <button
                        onClick={() => addToPool(l.id)}
                        disabled={poolBusy === l.id}
                        className="bv-btn bv-btn-ghost bv-tap text-[12px] inline-flex items-center gap-1.5"
                      >
                        {poolBusy === l.id
                          ? <Loader2 size={12} className="animate-spin" aria-hidden />
                          : <UserPlus size={12} strokeWidth={2} />}
                        {T("Add to pool", "In den Pool", "Ajouter au vivier")}
                      </button>
                    ) : null /* Only nurses go in the candidate pool. A clinic or
                        a company is a counterparty, not somebody we place, and
                        offering the button on their row invited a click that
                        would have made them a candidate account. */}
                  </div>
                </div>
                {extras.length > 0 && (
                  <div className="mt-3 pt-3 flex flex-wrap gap-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                    {extras.map(([k, v]) => (
                      <span key={k} className="bv-chip" style={{ fontSize: 11 }}>
                        <span style={{ color: "var(--w3)" }}>{k}:</span>&nbsp;{v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
