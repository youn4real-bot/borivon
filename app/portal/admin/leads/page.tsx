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
import { Modal } from "@/components/ui/Modal";
import { Mail, Phone, Clock, MessageSquare, UserPlus, UserCheck, Loader2, Check, Archive, RotateCcw } from "lucide-react";
import { isPlaceableLead } from "@/lib/leadKinds";
import { roadmapLeadChips, plainDetailChips } from "@/lib/roadmap/leadSummary";
import { PageHead, Btn, Card, Seg, Dot, Empty, Pager, usePaged, STATUS_DOT, type Status as KitStatus } from "@/components/fx/kit";

// The page's own small classes (the one design: hairline rows, the dot is the state, details one tap away).
const LEADS_CSS = `
.lds-row{display:flex;align-items:center;gap:12px;padding:7px 8px 7px 14px;border-radius:12px;background:var(--card);border:1px solid var(--border)}
.lds-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;background:none;border:0;padding:2px 0;text-align:left;cursor:pointer;font-family:inherit;color:var(--w)}
.lds-l1{display:flex;align-items:baseline;gap:10px;min-width:0;max-width:100%}
.lds-name{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lds-kind{flex:none;font-size:12.5px;color:var(--w3);white-space:nowrap}
.lds-l2{font-size:12.5px;color:var(--w3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.lds-when{flex:none;font-size:12.5px;color:var(--w3);white-space:nowrap;font-variant-numeric:tabular-nums}
.lds-act{flex:none;display:flex;align-items:center;gap:4px}
.lds-st{display:flex;justify-content:flex-end;gap:4px;width:250px}
.lds-pool{display:flex;width:150px}
.lds-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px;padding-top:14px;border-top:1px solid var(--border)}
.lds-ib{width:34px;padding:0!important}
@media (max-width:640px){
.lds-row{gap:8px;padding:7px 6px 7px 12px}
.lds-act{gap:2px}
.lds-st{width:70px;gap:2px}
.lds-pool{width:34px}
.lds-kv{grid-template-columns:minmax(0,1fr)}
}`;

type Lead = {
  id: string; kind: string; email: string; name: string; phone: string;
  message: string; details: Record<string, unknown> | null; created_at: string;
  /** Set once the lead has been turned into a Pool candidate. */
  candidate_user_id?: string | null;
  /** new | contacted | closed. Present since the table was created; nothing
   *  read or wrote it, so every lead looked untouched for ever. */
  status?: string | null;
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
  // The free Pflege-Fahrplan (borivon.com/fahrplan): answers, Stufe, consent in `details`.
  roadmap:     { en: "Roadmap (PDF)",   de: "Fahrplan (PDF)",  fr: "Plan (PDF)" },
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
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  // Default view hides what has been dealt with. With no ping on arrival, this
  // list WAS the funnel — and an un-workable list of eleven identical-looking
  // rows is why none of them were ever marked done.
  const [showDone, setShowDone] = useState(false);

  async function setStatus(leadId: string, status: "new" | "contacted" | "closed") {
    setStatusBusy(leadId);
    const prev = leads;
    // Optimistic: the row re-sorts/hides immediately, and we put it back if the
    // write fails, so a dropped connection can never leave a lead looking
    // handled when it is not.
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, status } : l)));
    try {
      const r = await fetch("/api/portal/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: leadId, status }),
      });
      if (!r.ok) setLeads(prev);
    } catch { setLeads(prev); }
    setStatusBusy(null);
  }

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
  const fmtShort = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });
    } catch { return iso; }
  };
  const kindLabel = (k: string) => { const e = KIND_LABEL[k]; return e ? T(e.en, e.de, e.fr) : k; };

  // A lead with no status at all is untouched — every existing row predates the
  // column being used, so treating null as "new" is what keeps them visible.
  const isDone = (l: Lead) => l.status === "contacted" || l.status === "closed";
  const openLeads = leads.filter((l) => !isDone(l));
  const doneCount = leads.length - openLeads.length;
  const shown = showDone ? leads : openLeads;

  // The row and its details popup — the one design: a hairline row per lead, the dot is its state
  // (orange waiting for you · green contacted · grey closed, LAW #4), everything else one tap away.
  const leadRow = (l: Lead, onOpen: () => void, narrow: boolean) => {
    const done = isDone(l);
    const st: KitStatus = l.status === "contacted" ? "approved" : l.status === "closed" ? "missing" : "pending";
    const line2 = [l.email, l.phone, (l.message || "").replace(/[\s·]+$/, "")].filter(Boolean).join(" · ");
    const sm = { size: "sm" as const, className: narrow ? "lds-ib" : undefined };
    return (
      <div key={l.id} className="lds-row" style={{ opacity: done ? 0.62 : 1 }}>
        <Dot st={st} />
        <button type="button" className="lds-open" onClick={onOpen} title={T("Details", "Details", "Détails")}>
          <span className="lds-l1">
            <span className="lds-name">{l.name || l.email}</span>
            <span className="lds-kind">{kindLabel(l.kind)}</span>
          </span>
          <span className="lds-l2">{narrow ? `${fmtShort(l.created_at)} · ${line2}` : line2}</span>
        </button>
        {!narrow && <span className="lds-when">{fmt(l.created_at)}</span>}
        <div className="lds-act">
          {/* Mark it dealt with. `status` shipped with the table and
              nothing ever wrote it, so eleven enquiries sat at "new"
              for three months with no way to tell an answered one
              from an ignored one. */}
          <div className="lds-st">
          {done ? (
            <Btn kind="quiet" {...sm} onClick={() => setStatus(l.id, "new")} disabled={statusBusy === l.id}
              title={T("Put it back in the waiting list", "Zurück in die Warteliste", "Remettre en attente")}
              aria-label={T("Put it back in the waiting list", "Zurück in die Warteliste", "Remettre en attente")}>
              <RotateCcw size={13} strokeWidth={2} />
              {!narrow && (l.status === "closed" ? T("Closed", "Geschlossen", "Fermé") : T("Contacted", "Kontaktiert", "Contacté"))}
            </Btn>
          ) : (
            <>
              <Btn {...sm} onClick={() => setStatus(l.id, "contacted")} disabled={statusBusy === l.id}
                title={T("I have replied to this person", "Ich habe geantwortet", "J'ai répondu")}
                aria-label={T("Contacted", "Kontaktiert", "Contacté")}>
                {statusBusy === l.id
                  ? <Loader2 size={13} className="animate-spin" aria-hidden />
                  : <Check size={13} strokeWidth={2.4} style={{ color: STATUS_DOT.approved }} />}
                {!narrow && T("Contacted", "Kontaktiert", "Contacté")}
              </Btn>
              <Btn kind="quiet" {...sm} onClick={() => setStatus(l.id, "closed")} disabled={statusBusy === l.id}
                title={T("Not going anywhere — hide it", "Nicht relevant — ausblenden", "Sans suite — masquer")}
                aria-label={T("Close", "Schließen", "Fermer")}>
                <Archive size={13} strokeWidth={2} />
                {!narrow && T("Close", "Schließen", "Fermer")}
              </Btn>
            </>
          )}
          </div>

          {/* The missing hop: a lead is somebody who reached out, but
              the Pool lives in candidate_pipeline and only holds real
              accounts — so until now every lead had to be re-created
              by hand. One press puts them in the Pool. */}
          <div className="lds-pool">
          {l.candidate_user_id ? (
            <Btn kind="quiet" {...sm}
              // nav_user_id, not candidate — the admin panel reads the
              // former (page.tsx:1388) and has never read the latter,
              // so this button dropped the founder onto the panel with
              // nobody selected and no hint which person it meant.
              onClick={() => router.push(`/portal/admin?nav_user_id=${l.candidate_user_id}`)}
              title={T("In the pool", "Im Pool", "Dans le vivier")} aria-label={T("In the pool", "Im Pool", "Dans le vivier")}>
              <UserCheck size={13} strokeWidth={2} style={{ color: STATUS_DOT.approved }} />
              {!narrow && T("In the pool", "Im Pool", "Dans le vivier")}
            </Btn>
          ) : isPlaceableLead(l.kind) ? (
            <Btn {...sm} onClick={() => addToPool(l.id)} disabled={poolBusy === l.id}
              title={T("Add to pool", "In den Pool", "Ajouter au vivier")} aria-label={T("Add to pool", "In den Pool", "Ajouter au vivier")}>
              {poolBusy === l.id
                ? <Loader2 size={13} className="animate-spin" aria-hidden />
                : <UserPlus size={13} strokeWidth={2} />}
              {!narrow && T("Add to pool", "In den Pool", "Ajouter au vivier")}
            </Btn>
          ) : null /* Only individuals go in the candidate pool. A clinic or
              a company is a counterparty, not somebody we place, and
              offering the button on their row invited a click that
              would have made them a candidate account. */}
          </div>
        </div>
      </div>
    );
  };

  // Everything the lead told us: contact, message and (Fahrplan) their answers — in the popup (LAW #36).
  const leadDetails = (l: Lead) => {
    // Fahrplan leads keep nested objects in details; plain chips only for the rest.
    const extras = l.kind === "roadmap"
      ? roadmapLeadChips(l.details, lang === "de" || lang === "fr" ? lang : "en")
      : plainDetailChips(l.details);
    const ico: React.CSSProperties = { color: "var(--w3)", flexShrink: 0, marginTop: 3 };
    return (
      <div className="px-5 py-4" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 8, fontSize: 13.5, color: "var(--w2)" }}>
          <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}>
            <Mail size={14} style={ico} />
            <a href={`mailto:${l.email}`} style={{ color: "var(--w)", textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "var(--border2)", wordBreak: "break-all" }}>{l.email}</a>
          </span>
          {l.phone && (
            <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}><Phone size={14} style={ico} /> {l.phone}</span>
          )}
          {l.message && (
            <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8, whiteSpace: "pre-wrap" }}><MessageSquare size={14} style={ico} /> {l.message.replace(/[\s·]+$/, "")}</span>
          )}
          <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--w3)" }}><Clock size={14} style={ico} /> {fmt(l.created_at)}</span>
        </div>
        {extras.length > 0 && (
          <div className="lds-kv">
            {extras.map(({ k, v }) => (
              <div key={k} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{k}</div>
                <div style={{ marginTop: 2, fontSize: 13.5, color: "var(--w)", overflowWrap: "anywhere" }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <main id="bv-main" className="mx-auto px-5 bv-page-bottom" style={{ maxWidth: 980, paddingTop: 88, paddingBottom: 20 }}>
      <style>{LEADS_CSS}</style>
      <PageHead
        back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Leads", "Anfragen", "Prospects")}
        sub={<><b style={{ fontWeight: 600, color: "var(--w)" }}>{openLeads.length}</b> {T("waiting for you", "warten auf dich", "en attente")}</>}
        actions={doneCount > 0 ? (
          // Default view hides what has been dealt with; the done ones are one tap away.
          <Seg value={showDone ? "all" : "open"} onChange={(v) => setShowDone(v === "all")}
            options={[
              ["open", `${T("Open", "Offen", "Ouvertes")} ${openLeads.length}`],
              ["all", `${T("All", "Alle", "Toutes")} ${leads.length}`],
            ]} />
        ) : undefined}
      />

      {poolErr && (
        <p role="alert" style={{ margin: "0 0 10px", fontSize: 13, color: STATUS_DOT.rejected }}>{poolErr}</p>
      )}

      {shown.length === 0 ? (
        <Card>
          <Empty>
            {leads.length === 0
              ? T("No leads yet.", "Noch keine Anfragen.", "Aucune demande pour le moment.")
              : T("Nothing waiting — every lead is dealt with.",
                  "Nichts offen — alle Anfragen sind erledigt.",
                  "Rien en attente — toutes les demandes sont traitées.")}
          </Empty>
        </Card>
      ) : (
        <LeadList leads={shown} row={leadRow} details={leadDetails}
          title={(l) => l.name || l.email} subtitle={(l) => `${kindLabel(l.kind)} · ${fmt(l.created_at)}`} />
      )}
    </main>
  );
}

/** The leads, one page at a time (nobody scrolls); a tap on a lead opens its details in the popup. */
function LeadList({ leads, row, details, title, subtitle }: {
  leads: Lead[];
  row: (l: Lead, onOpen: () => void, narrow: boolean) => React.ReactNode;
  details: (l: Lead) => React.ReactNode;
  title: (l: Lead) => string;
  subtitle: (l: Lead) => string;
}) {
  const { slice, page, pages, setPage, narrow } = usePaged(leads, 7, 6);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? leads.find((l) => l.id === openId) ?? null : null;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((l) => row(l, () => setOpenId(l.id), narrow))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      <Modal open={!!open} onClose={() => setOpenId(null)} size="md" title={open ? title(open) : ""} subtitle={open ? subtitle(open) : ""}>
        {open && details(open)}
      </Modal>
    </>
  );
}
