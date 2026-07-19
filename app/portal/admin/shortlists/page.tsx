"use client";

/**
 * Employer Shortlists (ALL admins, scoped) — build a curated, ordered set of
 * candidates for an employer and share a read-only link they open without a
 * login. Backed by /api/portal/admin/shortlists* (LAW #25: supreme sees all,
 * org-admins only their org's). The public view lives at /portal/shortlist/<token>.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { b2StageLabel, normalizeB2Stage } from "@/lib/b2Journey";
import { ArrowLeft, Plus, Search, Trash2, ChevronUp, ChevronDown, Link2, RefreshCw, Users, Copy, Check, CheckCircle2 } from "lucide-react";

type Org = { id: string; name: string };
type ListItem = { id: string; title: string; note: string; status: string; shareToken: string | null; orgId: string | null; agency: string | null; employer: string | null; count: number; createdAt: string };
type Cand = {
  userId: string; name: string; email: string; photo: string | null; verified: boolean;
  nationality: string | null; city: string | null; profession: string | null; b2Stage: string | null;
  yearsExperience: number | null; docCount: number; docsOk: number; docsPending: number; hasCvDraft: boolean;
  position: number; adminNote: string;
};
type Detail = { shortlist: { id: string; title: string; note: string; status: string; shareToken: string | null; orgId: string | null; employerId: string | null }; candidates: Cand[] };
type PickCand = { uid: string; name: string; email: string };

export default function AdminShortlistsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [items, setItems] = useState<ListItem[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [employers, setEmployers] = useState<Org[]>([]);
  const [isSupreme, setIsSupreme] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // create form
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", orgId: "", employerId: "" });
  // add-candidate picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickList, setPickList] = useState<PickCand[]>([]);
  const [pickLoaded, setPickLoaded] = useState(false);
  const [pickQuery, setPickQuery] = useState("");

  const authFetch = useCallback((url: string, init?: RequestInit) =>
    fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } }), [token]);

  const loadList = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/admin/shortlists", { headers: { Authorization: `Bearer ${tk}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
    const j = await res.json().catch(() => ({}));
    setItems((j.shortlists ?? []) as ListItem[]);
    setOrgs((j.orgs ?? []) as Org[]);
    setEmployers((j.employers ?? []) as Org[]);
    setIsSupreme(j.role === "admin");
  }, [router]);

  const loadDetail = useCallback(async (id: string, tk: string) => {
    const res = await fetch(`/api/portal/admin/shortlists/${id}`, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) { setErr(T("Could not load the shortlist.", "Konnte die Liste nicht laden.", "Impossible de charger la liste.")); return; }
    setDetail(await res.json());
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) { try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep */ } }
      if (cancelled) return;
      setToken(tk);
      await loadList(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, loadList]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { if (session?.access_token) setToken(session.access_token); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const openDetail = async (id: string) => { setSelected(id); setDetail(null); setErr(""); await loadDetail(id, token); };
  const backToList = async () => { setSelected(null); setDetail(null); await loadList(token); };

  const createShortlist = async () => {
    if (!form.title.trim() || busy) return;
    setBusy(true);
    const res = await authFetch("/api/portal/admin/shortlists", { method: "POST", body: JSON.stringify({ title: form.title.trim(), orgId: form.orgId || undefined, employerId: form.employerId || undefined }) });
    setBusy(false);
    if (res.ok) { const j = await res.json().catch(() => ({})); setShowNew(false); setForm({ title: "", orgId: "", employerId: "" }); await loadList(token); if (j.id) openDetail(j.id); }
    else setErr(T("Could not create the shortlist.", "Konnte die Liste nicht erstellen.", "Impossible de créer la liste."));
  };

  const patchShortlist = async (patch: Record<string, unknown>) => {
    if (!selected) return;
    const res = await authFetch(`/api/portal/admin/shortlists/${selected}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (res.ok) await loadDetail(selected, token);
    else setErr(T("Could not save.", "Konnte nicht speichern.", "Échec de l'enregistrement."));
  };

  const deleteShortlist = async () => {
    if (!selected || busy) return;
    if (!confirm(T("Delete this shortlist? The share link stops working.", "Diese Liste löschen? Der Freigabelink funktioniert dann nicht mehr.", "Supprimer cette liste ? Le lien de partage cessera de fonctionner."))) return;
    setBusy(true);
    const res = await authFetch(`/api/portal/admin/shortlists/${selected}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) await backToList();
  };

  const addCandidate = async (uid: string) => {
    if (!selected) return;
    const res = await authFetch(`/api/portal/admin/shortlists/${selected}/candidates`, { method: "POST", body: JSON.stringify({ candidateUserId: uid }) });
    if (res.ok) await loadDetail(selected, token);
  };
  const removeCandidate = async (uid: string) => {
    if (!selected) return;
    const res = await authFetch(`/api/portal/admin/shortlists/${selected}/candidates`, { method: "DELETE", body: JSON.stringify({ candidateUserId: uid }) });
    if (res.ok) await loadDetail(selected, token);
  };
  const move = async (idx: number, dir: -1 | 1) => {
    if (!selected || !detail) return;
    const order = detail.candidates.map((c) => c.userId);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    setDetail({ ...detail, candidates: order.map((uid, i) => ({ ...detail.candidates.find((c) => c.userId === uid)!, position: i })) });
    await authFetch(`/api/portal/admin/shortlists/${selected}/candidates`, { method: "PATCH", body: JSON.stringify({ order }) });
  };

  // Candidate picker — load the admin's scoped candidate list once (names only).
  const openPicker = async () => {
    setPickerOpen(true);
    if (pickLoaded) return;
    const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({}));
    const users = (j.users ?? {}) as Record<string, { name: string; email: string }>;
    setPickList(Object.entries(users).map(([uid, u]) => ({ uid, name: u.name || u.email || uid, email: u.email || "" })).sort((a, b) => a.name.localeCompare(b.name)));
    setPickLoaded(true);
  };

  const copyLink = (tk: string) => {
    const url = `${window.location.origin}/portal/shortlist/${tk}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  };

  if (loading) return <PageLoader />;

  const fmtCand = (c: Cand) => {
    const bits = [
      c.profession ? specialtyLabel(c.profession, lang) : "",
      c.city || "",
      c.yearsExperience != null ? `${c.yearsExperience} ${T("yrs", "J.", "ans")}` : "",
      c.b2Stage ? `B2 ${b2StageLabel(normalizeB2Stage(c.b2Stage), lang)}` : "",
    ].filter(Boolean);
    return bits.join(" · ");
  };

  // ── LIST VIEW ──
  if (!selected) {
    return (
      <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 880 }}>
        <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
          <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
        </button>
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="bv-h1">{T("Employer shortlists", "Arbeitgeber-Listen", "Listes employeur")}</h1>
            <p className="bv-body mt-1">{T("Curate candidates for an employer and share a read-only link.", "Kandidaten für einen Arbeitgeber kuratieren und einen schreibgeschützten Link teilen.", "Sélectionnez des candidats pour un employeur et partagez un lien en lecture seule.")}</p>
          </div>
          <button onClick={() => setShowNew(true)} className="bv-btn bv-btn-gold inline-flex">
            <Plus size={15} strokeWidth={2} /> {T("New shortlist", "Neue Liste", "Nouvelle liste")}
          </button>
        </div>
        {err && <p className="mb-3 text-[12px]" style={{ color: "#ef4444" }}>{err}</p>}
        {items.length === 0 ? (
          <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
            {T("No shortlists yet — create one to get started.", "Noch keine Listen — erstelle eine.", "Aucune liste — créez-en une.")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((s) => (
              <button key={s.id} onClick={() => openDetail(s.id)}
                className="w-full text-left p-4 flex items-center gap-3 transition-colors hover:opacity-90"
                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
                <Users size={16} style={{ color: "var(--w3)" }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--w)" }}>{s.title}</span>
                  <span className="block text-[11.5px] truncate" style={{ color: "var(--w3)" }}>
                    {[s.agency, s.employer].filter(Boolean).join(" → ") || T("No agency", "Keine Agentur", "Aucune agence")} · {s.count} {T("candidates", "Kandidaten", "candidats")}
                  </span>
                </span>
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={s.status === "shared"
                    ? { background: "rgba(22,163,74,0.12)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.38)" }
                    : { background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                  {s.status === "shared" ? T("Shared", "Geteilt", "Partagé") : T("Draft", "Entwurf", "Brouillon")}
                </span>
              </button>
            ))}
          </div>
        )}

        <Modal open={showNew} onClose={() => !busy && setShowNew(false)} size="sm" busy={busy}
          title={T("New shortlist", "Neue Liste", "Nouvelle liste")}
          footer={<><GhostButton onClick={() => setShowNew(false)} disabled={busy}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
            <GoldButton onClick={createShortlist} disabled={busy || !form.title.trim()}>{T("Create", "Erstellen", "Créer")}</GoldButton></>}>
          <div className="px-5 py-4 space-y-3">
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Title", "Titel", "Titre")}</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="UKSH Kiel — April 2027"
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
            </label>
            {(isSupreme || orgs.length > 1) && (
              <label className="block">
                <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Agency", "Agentur", "Agence")}</span>
                <select value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                  <option value="">{isSupreme ? T("— none (HQ) —", "— keine (HQ) —", "— aucune (HQ) —") : T("— choose —", "— wählen —", "— choisir —")}</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--w3)" }}>{T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)")}</span>
              <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-[14px] rounded-md" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
                <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
                {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          </div>
        </Modal>
      </main>
    );
  }

  // ── DETAIL VIEW ──
  const sl = detail?.shortlist;
  const shareUrl = sl?.shareToken ? `/portal/shortlist/${sl.shareToken}` : "";
  const onList = new Set((detail?.candidates ?? []).map((c) => c.userId));
  const pickable = pickList.filter((p) => !onList.has(p.uid)).filter((p) => !pickQuery.trim() || p.name.toLowerCase().includes(pickQuery.trim().toLowerCase())).slice(0, 40);

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 880 }}>
      <button onClick={backToList} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("All shortlists", "Alle Listen", "Toutes les listes")}
      </button>

      {!detail ? <PageLoader /> : (
        <>
          {/* Header + share controls */}
          <div className="p-4 sm:p-5 mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
            <input value={sl!.title} onChange={(e) => setDetail({ ...detail, shortlist: { ...sl!, title: e.target.value } })}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== "" && patchShortlist({ title: e.target.value.trim() })}
              className="w-full text-[17px] font-semibold bg-transparent outline-none mb-1" style={{ color: "var(--w)" }} />
            <textarea value={sl!.note} onChange={(e) => setDetail({ ...detail, shortlist: { ...sl!, note: e.target.value } })}
              onBlur={(e) => patchShortlist({ note: e.target.value })} rows={2}
              placeholder={T("A note shown at the top of the shared view (optional)…", "Ein Hinweis oben in der geteilten Ansicht (optional)…", "Une note en haut de la vue partagée (optionnel)…")}
              className="w-full text-[12.5px] bg-transparent outline-none resize-y" style={{ color: "var(--w2)" }} />

            <div className="mt-3 pt-3 flex flex-wrap items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={() => patchShortlist({ status: sl!.status === "shared" ? "draft" : "shared" })}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5"
                style={sl!.status === "shared"
                  ? { background: "rgba(22,163,74,0.12)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.38)" }
                  : { background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                {sl!.status === "shared" ? <><CheckCircle2 size={13} /> {T("Shared — live", "Geteilt — live", "Partagé — en ligne")}</> : <><Link2 size={13} /> {T("Share this list", "Liste teilen", "Partager la liste")}</>}
              </button>
              {sl!.status === "shared" && shareUrl && (
                <>
                  <button onClick={() => copyLink(sl!.shareToken!)} className="text-[12px] px-3 py-1.5 rounded-md inline-flex items-center gap-1.5" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    {copied ? <><Check size={13} style={{ color: "#16a34a" }} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={13} /> {T("Copy link", "Link kopieren", "Copier le lien")}</>}
                  </button>
                  <a href={shareUrl} target="_blank" rel="noreferrer" className="text-[12px] px-3 py-1.5 rounded-md inline-flex items-center gap-1.5" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    {T("Open view", "Ansicht öffnen", "Ouvrir la vue")}
                  </a>
                  <button onClick={() => patchShortlist({ regenToken: true })} className="text-[11.5px] px-2.5 py-1.5 rounded-md inline-flex items-center gap-1" style={{ color: "var(--w3)", border: "1px solid var(--border)" }} title={T("New link (old one stops working)", "Neuer Link (alter wird ungültig)", "Nouveau lien (l'ancien cesse)")}>
                    <RefreshCw size={12} /> {T("New link", "Neuer Link", "Nouveau lien")}
                  </button>
                </>
              )}
              <button onClick={deleteShortlist} className="text-[11.5px] px-2.5 py-1.5 rounded-md inline-flex items-center gap-1 ml-auto" style={{ color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                <Trash2 size={12} /> {T("Delete", "Löschen", "Supprimer")}
              </button>
            </div>
            {sl!.status === "shared" && (
              <p className="mt-2 text-[10.5px]" style={{ color: "var(--w3)" }}>
                {T("Anyone with this link can view these candidates (name, photo, profession, city, B2, experience — no contact details or documents). Switch back to Draft or make a new link to revoke.",
                   "Jeder mit diesem Link kann diese Kandidaten sehen (Name, Foto, Fachbereich, Ort, B2, Erfahrung — keine Kontaktdaten oder Dokumente). Auf Entwurf zurückstellen oder neuen Link erzeugen, um zu widerrufen.",
                   "Toute personne disposant de ce lien peut voir ces candidats (nom, photo, spécialité, ville, B2, expérience — aucune coordonnée ni document). Repassez en Brouillon ou générez un nouveau lien pour révoquer.")}
              </p>
            )}
          </div>

          {err && <p className="mb-3 text-[12px]" style={{ color: "#ef4444" }}>{err}</p>}

          {/* Candidates */}
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[12px] font-semibold" style={{ color: "var(--w2)" }}>{detail.candidates.length} {T("candidates", "Kandidaten", "candidats")}</span>
            <button onClick={openPicker} className="bv-btn bv-btn-gold inline-flex"><Plus size={14} /> {T("Add candidate", "Kandidat hinzufügen", "Ajouter")}</button>
          </div>

          {detail.candidates.length === 0 ? (
            <div className="text-center py-12 text-[13px]" style={{ color: "var(--w3)" }}>{T("No candidates yet — add some above.", "Noch keine Kandidaten — oben hinzufügen.", "Aucun candidat — ajoutez-en ci-dessus.")}</div>
          ) : (
            <div className="space-y-2">
              {detail.candidates.map((c, i) => (
                <div key={c.userId} className="p-3 flex items-center gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" }}>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-25" style={{ color: "var(--w3)" }}><ChevronUp size={15} /></button>
                    <button onClick={() => move(i, 1)} disabled={i === detail.candidates.length - 1} className="disabled:opacity-25" style={{ color: "var(--w3)" }}><ChevronDown size={15} /></button>
                  </div>
                  {c.photo
                    ? <img src={c.photo} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                    : <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-bold" style={{ background: "var(--bg2)", color: "var(--w3)" }}>{c.name.charAt(0).toUpperCase()}</div>}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold truncate flex items-center gap-1.5" style={{ color: "var(--w)" }}>{c.name}{c.verified && <Check size={12} strokeWidth={3} style={{ color: "#16a34a" }} />}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--w3)" }}>{fmtCand(c) || T("Profile not filled yet", "Profil noch nicht ausgefüllt", "Profil non rempli")}</p>
                  </div>
                  <span className="text-[10.5px] flex-shrink-0" style={{ color: "var(--w3)" }}>{c.docsOk}/{c.docCount} {T("docs", "Dok.", "docs")}</span>
                  <button onClick={() => removeCandidate(c.userId)} className="flex-shrink-0" style={{ color: "var(--w3)" }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Add-candidate picker */}
          <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} size="sm"
            title={T("Add a candidate", "Kandidat hinzufügen", "Ajouter un candidat")}>
            <div className="px-5 py-4">
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--w3)" }} />
                <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} autoFocus placeholder={T("Search a candidate…", "Kandidat suchen…", "Rechercher…")}
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-md outline-none" style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {!pickLoaded ? <p className="text-center py-4 text-[12px]" style={{ color: "var(--w3)" }}>{T("Loading…", "Lädt…", "Chargement…")}</p>
                  : pickable.length === 0 ? <p className="text-center py-4 text-[12px]" style={{ color: "var(--w3)" }}>{T("No candidates to add.", "Keine Kandidaten.", "Aucun candidat.")}</p>
                  : pickable.map((p) => (
                    <div key={p.uid} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-[13px] min-w-0 truncate" style={{ color: "var(--w2)" }}>{p.name}</span>
                      <button onClick={() => addCandidate(p.uid)} className="flex-shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{T("Add", "Hinzufügen", "Ajouter")}</button>
                    </div>
                  ))}
              </div>
            </div>
          </Modal>
        </>
      )}
    </main>
  );
}
