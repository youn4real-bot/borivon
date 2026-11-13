"use client";

/**
 * Employer Shortlists (ALL admins, scoped) — build a curated, ordered set of
 * candidates for an employer and share a read-only link they open without a
 * login. Backed by /api/portal/admin/shortlists* (LAW #25: supreme sees all,
 * org-admins only their org's). The public view lives at /portal/shortlist/<token>.
 */
import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal } from "@/components/ui/Modal";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { b2StageLabel, normalizeB2Stage } from "@/lib/b2Journey";
import { Plus, Search, Trash2, ChevronUp, ChevronDown, Link2, RefreshCw, Copy, Check } from "lucide-react";
import { PageHead, BackLink, KitStyle, Btn, Card, Dot, Field, Empty, Pager, usePaged, STATUS_TINT, type Status as KitStatus } from "@/components/fx/kit";

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
      // "B2 bestanden" already says B2 — no "B2 B2 bestanden"
      c.b2Stage ? (normalizeB2Stage(c.b2Stage) === "passed" ? b2StageLabel("passed", lang) : `B2 ${b2StageLabel(normalizeB2Stage(c.b2Stage), lang)}`) : "",
    ].filter(Boolean);
    return bits.join(" · ");
  };

  // ── LIST VIEW ──
  if (!selected) {
    return (
      <main id="bv-main" className="mx-auto px-5 bv-page-bottom" style={{ maxWidth: 760, paddingTop: 72, paddingBottom: 28 }}>
        <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
          title={T("Employer shortlists", "Arbeitgeber-Listen", "Listes employeur")}
          sub={T("Curate candidates for an employer and share a read-only link.", "Kandidaten für einen Arbeitgeber auswählen und per Link teilen.", "Sélectionnez des candidats et partagez un lien en lecture seule.")}
          actions={<Btn kind="primary" onClick={() => setShowNew(true)}><Plus size={15} strokeWidth={2} /> {T("New shortlist", "Neue Liste", "Nouvelle liste")}</Btn>} />
        {err && <p style={ERR}>{err}</p>}
        {items.length === 0 ? (
          <Card><Empty>{T("No shortlists yet — create one to get started.", "Noch keine Listen — erstelle eine.", "Aucune liste — créez-en une.")}</Empty></Card>
        ) : (
          // shared = green (live), draft = paper; the list flips instead of scrolling
          <ShortlistRows items={items} onOpen={(id) => openDetail(id)} T={T} />
        )}

        <Modal open={showNew} onClose={() => !busy && setShowNew(false)} size="sm" busy={busy}
          title={T("New shortlist", "Neue Liste", "Nouvelle liste")}
          footer={<><Btn kind="quiet" size="sm" onClick={() => setShowNew(false)} disabled={busy}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
            <Btn kind="primary" size="sm" onClick={createShortlist} disabled={busy || !form.title.trim()}>{T("Create", "Erstellen", "Créer")}</Btn></>}>
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label={T("Title", "Titel", "Titre")}>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="UKSH Kiel — April 2027" className="bvk-input" />
            </Field>
            {(isSupreme || orgs.length > 1) && (
              <Field label={T("Agency", "Agentur", "Agence")}>
                <select value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} className="bvk-input">
                  <option value="">{isSupreme ? T("— none (HQ) —", "— keine (HQ) —", "— aucune (HQ) —") : T("— choose —", "— wählen —", "— choisir —")}</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={T("Employer (optional)", "Arbeitgeber (optional)", "Employeur (optionnel)")}>
              <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })} className="bvk-input">
                <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
                {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
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
    <main id="bv-main" className="mx-auto px-5 bv-page-bottom" style={{ maxWidth: 760, paddingTop: 72, paddingBottom: 28 }}>
      <KitStyle />
      {/* the list's title edits in place in the page-title look (serif); a hairline shows only on hover / focus */}
      <style>{".bvs-edit{display:block;width:100%;background:transparent;border:0;border-bottom:1px solid transparent;outline:none;padding:0;font-family:inherit;color:var(--w);transition:border-color .15s}.bvs-edit:hover,.bvs-edit:focus{border-bottom-color:var(--border)}"
        + ".bvs-title{font-family:var(--font-serif);font-weight:400;font-size:32px;line-height:1.15;letter-spacing:-.01em}.bvs-note{margin-top:4px;font-size:13.5px;line-height:1.45;color:var(--w3);resize:none}"
        + "@media (max-width:640px){.bvs-title{font-size:28px}.bvs-lbl{display:none}.bvs-cands{margin:16px 0 10px!important;padding-top:14px!important}}"}</style>
      <div style={{ marginBottom: 14 }}><BackLink label={T("All shortlists", "Alle Listen", "Toutes les listes")} onClick={backToList} /></div>

      {!detail ? <PageLoader /> : (
        <>
          {/* Header — the title + note edit in place */}
          <input value={sl!.title} onChange={(e) => setDetail({ ...detail, shortlist: { ...sl!, title: e.target.value } })}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== "" && patchShortlist({ title: e.target.value.trim() })}
            aria-label={T("Title", "Titel", "Titre")} className="bvs-edit bvs-title" />
          <textarea value={sl!.note} onChange={(e) => setDetail({ ...detail, shortlist: { ...sl!, note: e.target.value } })}
            onBlur={(e) => patchShortlist({ note: e.target.value })} rows={2}
            placeholder={T("A note shown at the top of the shared view (optional)…", "Ein Hinweis oben in der geteilten Ansicht (optional)…", "Une note en haut de la vue partagée (optionnel)…")}
            className="bvs-edit bvs-note" />

          {/* share controls — one quiet row */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14 }}>
            <Btn kind="ghost" size="sm" onClick={() => patchShortlist({ status: sl!.status === "shared" ? "draft" : "shared" })}>
              {sl!.status === "shared" ? <><Dot st="approved" size={8} /> {T("Shared — live", "Geteilt — live", "Partagé — en ligne")}</> : <><Link2 size={13} /> {T("Share this list", "Liste teilen", "Partager la liste")}</>}
            </Btn>
            {sl!.status === "shared" && shareUrl && (
              <>
                <Btn kind="ghost" size="sm" onClick={() => copyLink(sl!.shareToken!)}>
                  {copied ? <><Dot st="approved" size={8} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={13} /> {T("Copy link", "Link kopieren", "Copier le lien")}</>}
                </Btn>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="bvk-btn bvk-ghost bvk-sm">
                  {T("Open view", "Ansicht öffnen", "Ouvrir la vue")}
                </a>
                <Btn kind="quiet" size="sm" onClick={() => patchShortlist({ regenToken: true })} title={T("New link (old one stops working)", "Neuer Link (alter wird ungültig)", "Nouveau lien (l'ancien cesse)")} aria-label={T("New link", "Neuer Link", "Nouveau lien")}>
                  <RefreshCw size={12} /> <span className="bvs-lbl">{T("New link", "Neuer Link", "Nouveau lien")}</span>
                </Btn>
              </>
            )}
            <Btn kind="danger" size="sm" onClick={deleteShortlist} style={{ marginLeft: "auto" }} aria-label={T("Delete", "Löschen", "Supprimer")}>
              <Trash2 size={12} /> <span className="bvs-lbl">{T("Delete", "Löschen", "Supprimer")}</span>
            </Btn>
          </div>
          {sl!.status === "shared" && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.45, color: "var(--w3)" }}>
              {T("The link shows name, photo, profession, city, B2, experience — no contacts, no documents. Revoke: Draft or a new link.",
                 "Der Link zeigt Name, Foto, Fach, Ort, B2, Erfahrung — keine Kontakte, keine Dokumente. Widerruf: Entwurf oder neuer Link.",
                 "Le lien montre nom, photo, spécialité, ville, B2, expérience — ni contacts, ni documents. Révoquer : Brouillon ou nouveau lien.")}
            </p>
          )}

          {err && <p style={{ ...ERR, marginTop: 12 }}>{err}</p>}

          {/* Candidates */}
          <div className="bvs-cands" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "22px 0 12px", paddingTop: 18, borderTop: "1px solid var(--border)" }}>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, fontSize: 13, color: "var(--w3)" }}>
              <b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1, color: "var(--w)" }}>{detail.candidates.length}</b>{T("candidates", "Kandidaten", "candidats")}
            </span>
            <Btn kind="primary" size="sm" onClick={openPicker}><Plus size={14} /> {T("Add candidate", "Kandidat hinzufügen", "Ajouter")}</Btn>
          </div>

          {detail.candidates.length === 0 ? (
            <Card><Empty>{T("No candidates yet — add some above.", "Noch keine Kandidaten — oben hinzufügen.", "Aucun candidat — ajoutez-en ci-dessus.")}</Empty></Card>
          ) : (
            <CandidateRows cands={detail.candidates} fmtCand={fmtCand} onMove={move} onRemove={removeCandidate} T={T} />
          )}

          {/* Add-candidate picker */}
          <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} size="sm"
            title={T("Add a candidate", "Kandidat hinzufügen", "Ajouter un candidat")}>
            <div style={{ padding: "16px 20px 18px" }}>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={14} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--w3)", pointerEvents: "none" }} />
                <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} autoFocus placeholder={T("Search a candidate…", "Kandidat suchen…", "Rechercher…")}
                  className="bvk-input" style={{ paddingLeft: 36 }} />
              </div>
              {!pickLoaded ? <p style={{ ...QUIET, textAlign: "center", padding: "16px 0" }}>{T("Loading…", "Lädt…", "Chargement…")}</p>
                : pickable.length === 0 ? <p style={{ ...QUIET, textAlign: "center", padding: "16px 0" }}>{T("No candidates to add.", "Keine Kandidaten.", "Aucun candidat.")}</p>
                : <PickRows key={pickQuery} pickable={pickable} onAdd={(uid) => addCandidate(uid)} T={T} />}
            </div>
          </Modal>
        </>
      )}
    </main>
  );
}

// ── the one design (founder 2026-11-13): small views so the lists can page (hooks at their top level) ──
const ERR: CSSProperties = { margin: "0 0 12px", fontSize: 13, color: "#dc2626" };
const QUIET: CSSProperties = { margin: 0, fontSize: 13, color: "var(--w3)" };
type Tr = (en: string, de: string, fr: string) => string;
const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** the shortlists: shared = green tinted (live), draft = paper; 8 per page (phone 6) */
function ShortlistRows({ items, onOpen, T }: { items: ListItem[]; onOpen: (id: string) => void; T: Tr }) {
  const { slice, page, pages, setPage } = usePaged(items, 8, 6);
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((s) => {
          const st: KitStatus = s.status === "shared" ? "approved" : "missing";
          return (
            <button key={s.id} type="button" onClick={() => onOpen(s.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                background: st === "missing" ? "var(--card)" : STATUS_TINT[st], border: st === "missing" ? "1px solid var(--border)" : "1px solid transparent" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "var(--w)", ...ellipsis }}>{s.title}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--w3)", marginTop: 2, ...ellipsis }}>
                  {[s.agency, s.employer].filter(Boolean).join(" → ") || T("No agency", "Keine Agentur", "Aucune agence")} · {s.count} {T("candidates", "Kandidaten", "candidats")}
                </span>
              </span>
              <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: st === "missing" ? "var(--w3)" : "var(--w)" }}>
                {s.status === "shared" ? T("Shared", "Geteilt", "Partagé") : T("Draft", "Entwurf", "Brouillon")}
              </span>
            </button>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}

/** the candidates on a list, in the employer's order: ‹ › reorder, their face, the facts, papers ready (dot), remove */
function CandidateRows({ cands, fmtCand, onMove, onRemove, T }: { cands: Cand[]; fmtCand: (c: Cand) => string; onMove: (idx: number, dir: -1 | 1) => void; onRemove: (uid: string) => void; T: Tr }) {
  const { slice, page, pages, setPage } = usePaged(cands, 5, 4);
  const arrow = (dis: boolean): CSSProperties => ({ display: "grid", placeItems: "center", width: 22, height: 18, padding: 0, background: "none", border: 0, cursor: dis ? "default" : "pointer", color: "var(--w3)", opacity: dis ? 0.25 : 1 });
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((c) => {
          const i = cands.findIndex((x) => x.userId === c.userId); // the place in the whole list (pages flip)
          const docs: KitStatus = c.docCount > 0 && c.docsOk === c.docCount ? "approved" : c.docsPending > 0 ? "pending" : "missing";
          return (
            <div key={c.userId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 8px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label={T("Move up", "Nach oben", "Monter")} style={arrow(i === 0)}><ChevronUp size={15} /></button>
                <button type="button" onClick={() => onMove(i, 1)} disabled={i === cands.length - 1} aria-label={T("Move down", "Nach unten", "Descendre")} style={arrow(i === cands.length - 1)}><ChevronDown size={15} /></button>
              </div>
              {c.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.photo} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flex: "none" }} />
                : <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", background: "var(--bg2)", fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--w2)" }}>{c.name.charAt(0).toUpperCase()}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--w)", minWidth: 0 }}>
                  <span style={ellipsis}>{c.name}</span>{c.verified && <Check size={13} strokeWidth={2.6} aria-label={T("Verified", "Geprüft", "Vérifié")} style={{ color: "#16a34a", flex: "none" }} />}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--w3)", ...ellipsis }}>{fmtCand(c) || T("Profile not filled yet", "Profil noch nicht ausgefüllt", "Profil non rempli")}</p>
              </div>
              <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--w3)", fontVariantNumeric: "tabular-nums" }}>
                <Dot st={docs} size={7} />{c.docsOk}/{c.docCount} {T("docs", "Dok.", "docs")}
              </span>
              <Btn kind="quiet" size="sm" icon onClick={() => onRemove(c.userId)} aria-label={T("Remove", "Entfernen", "Retirer")} style={{ width: 30 }}><Trash2 size={14} /></Btn>
            </div>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}

/** the add-candidate picker: hairline rows, 7 per page (phone 6) instead of a scroll box */
function PickRows({ pickable, onAdd, T }: { pickable: PickCand[]; onAdd: (uid: string) => void; T: Tr }) {
  const { slice, page, pages, setPage } = usePaged(pickable, 7, 6);
  return (
    <>
      <div>
        {slice.map((p) => (
          <div key={p.uid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 14, color: "var(--w)", minWidth: 0, ...ellipsis }}>{p.name}</span>
            <Btn kind="ghost" size="sm" onClick={() => onAdd(p.uid)} style={{ flex: "none" }}>{T("Add", "Hinzufügen", "Ajouter")}</Btn>
          </div>
        ))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}
