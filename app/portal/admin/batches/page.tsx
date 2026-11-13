"use client";

/**
 * The Batch Board (supreme admin) — see which candidates are assigned to which
 * employer intake batch (UKSH ~10 every ~3 months) and where each sits on the
 * funnel. Reached from the profile-avatar menu → "Batches". This is the website
 * companion to the Telegram bot's batch tools + daily dropout radar.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { meToken } from "@/lib/meApi";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal } from "@/components/ui/Modal";
import { Plus, Users, CalendarRange } from "lucide-react";
import { PageHead, Btn, Card, Seg, Field, Empty, Pager, usePaged, STATUS_TINT, STATUS_DOT } from "@/components/fx/kit";

type Batch = { id: string; name: string; employerId: string | null; employer: string | null; orgId: string | null; agency: string | null; seats: number; filled: number; targetStart: string | null; targetEnd: string | null; status: string; notes: string | null };
type Cand = { userId: string; name: string; funnelStage: string | null; batchId: string | null };
type Employer = { id: string; name: string };
type Org = { id: string; name: string };
type BatchView = "open" | "nobatch" | "add";

// Funnel ladder (keys MUST match lib/batchBoard FUNNEL_STAGES + the bot enum).
const STAGES: { key: string; label: string }[] = [
  { key: "funneling", label: "Funneling" },
  { key: "screening", label: "Screening call" },
  { key: "interview1", label: "Interview 1" },
  { key: "waiting_2nd", label: "Waiting 2nd interview" },
  { key: "interview2", label: "Interview 2" },
  { key: "passed", label: "Passed" },
  { key: "departed", label: "Departed" },
];
const stageLabel = (k: string | null) => STAGES.find((s) => s.key === k)?.label ?? "—";

export default function AdminBatchesPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [candidates, setCandidates] = useState<Cand[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [form, setForm] = useState({ name: "", seats: 10, employerId: "", orgId: "", targetStart: "", targetEnd: "" });
  // the one design: which list is shown + whose candidates are open in the popup (view only)
  const [view, setView] = useState<BatchView>("open");
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  // The token in state is only the one read at mount — it expires after ~1h.
  // meToken() goes through getSession(), which refreshes an expired JWT.
  const freshToken = async () => (await meToken()) || token;

  const load = useCallback(async (tk: string, gate = false) => {
    const res = await fetch("/api/portal/batches", { headers: { Authorization: `Bearer ${(await meToken()) || tk}` } }).catch(() => null);
    if (!res || !res.ok) {
      // Only the first load is the role gate. A refused reload later (blip,
      // expired session) keeps the board on screen instead of bouncing an
      // admin to the candidate dashboard.
      if (gate && res && (res.status === 401 || res.status === 403)) router.replace("/portal/dashboard");
      return;
    }
    const j = await res.json().catch(() => ({}));
    setBatches((j.batches ?? []) as Batch[]);
    setCandidates((j.candidates ?? []) as Cand[]);
    setEmployers((j.employers ?? []) as Employer[]);
    setOrganizations((j.organizations ?? []) as Org[]);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep */ }
      }
      if (cancelled) return;
      setToken(tk);
      await load(tk, true);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  // PATCH a candidate's stage and/or batch, then refresh (the reload puts the
  // selects back to the server's value if the change was refused).
  const patchCand = async (candidateUserId: string, patch: { stage?: string; batchId?: string | null }) => {
    setSaveFailed(false);
    const res = await fetch("/api/portal/batches", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await freshToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ candidateUserId, ...patch }),
    }).catch(() => null);
    if (!res || !res.ok) setSaveFailed(true);
    await load(token);
    return !!res?.ok;
  };

  const createBatch = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/portal/batches", {
      method: "POST",
      headers: { Authorization: `Bearer ${await freshToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(), seats: form.seats,
        employerId: form.employerId || undefined,
        orgId: form.orgId || undefined,
        targetStart: form.targetStart || undefined, targetEnd: form.targetEnd || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) { setShowNew(false); setForm({ name: "", seats: 10, employerId: "", orgId: "", targetStart: "", targetEnd: "" }); await load(token); }
  };

  const closeBatch = async (batchId: string) => {
    setSaveFailed(false);
    const res = await fetch("/api/portal/batches", {
      method: "PATCH", headers: { Authorization: `Bearer ${await freshToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, close: true }),
    }).catch(() => null);
    if (!res || !res.ok) setSaveFailed(true);
    await load(token);
  };

  if (loading) return <PageLoader />;

  const openBatches = batches.filter((b) => b.status === "open");
  const onFunnelNoBatch = candidates.filter((c) => c.funnelStage && !c.batchId);
  const notOnFunnel = candidates.filter((c) => !c.funnelStage);
  const fmtWindow = (b: Batch) => [b.targetStart, b.targetEnd].filter(Boolean).join(" → ") || T("no window set", "kein Zeitfenster", "pas de fenêtre");

  // the three lists as one switch (an empty list hides its tab, as the old page hid the section)
  const tabs: [BatchView, string][] = [["open", `${T("Open", "Offen", "Ouverts")} · ${openBatches.length}`]];
  if (onFunnelNoBatch.length > 0) tabs.push(["nobatch", `${T("No batch yet", "Ohne Batch", "Sans lot")} · ${onFunnelNoBatch.length}`]);
  if (notOnFunnel.length > 0) tabs.push(["add", `${T("Not on the funnel", "Nicht im Funnel", "Hors funnel")} · ${notOnFunnel.length}`]);
  const tab: BatchView = tabs.some(([k]) => k === view) ? view : "open";
  const shown = openBatches.find((b) => b.id === openBatchId) ?? null;

  const selectSt: React.CSSProperties = { height: 34, fontSize: 13, padding: "0 8px", width: "auto", maxWidth: 190 };
  // Reusable per-candidate row: stage select + batch select.
  const candRow = (c: Cand, i: number) => (
    <div key={c.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
      <span style={{ fontSize: 14, color: "var(--w)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flex: "0 1 386px", minWidth: 0 }}>
        <select value={c.funnelStage ?? ""} onChange={(e) => patchCand(c.userId, { stage: e.target.value })} className="bvk-input" style={{ ...selectSt, flex: "1 1 0", minWidth: 0 }}>
          <option value="" disabled>{T("stage…", "Phase…", "étape…")}</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={c.batchId ?? ""} onChange={(e) => patchCand(c.userId, { batchId: e.target.value || null })} className="bvk-input" style={{ ...selectSt, flex: "1 1 0", minWidth: 0 }}>
          <option value="">{T("— no batch —", "— kein Batch —", "— aucun —")}</option>
          {openBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
    </div>
  );

  // the one design (founder 2026-11-13): serif head, one black "new" pill, the lists as a switch of hairline
  // rows that flip; a batch's candidates + the new-batch form in the universal popup (LAW #36)
  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 820, paddingTop: 88 }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Batches", "Batches", "Lots")}
        sub={T("Employer intakes + where each candidate sits on the funnel.", "Arbeitgeber-Intakes + wo jeder Kandidat im Funnel steht.", "Recrutements employeur + position de chaque candidat dans le funnel.")}
        actions={<Btn kind="primary" size="sm" onClick={() => setShowNew(true)}><Plus size={14} strokeWidth={2} />{T("New batch", "Neuer Batch", "Nouveau lot")}</Btn>} />

      {saveFailed && (
        <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
          {T("Couldn't save that change — nothing was changed. Try again.",
             "Änderung konnte nicht gespeichert werden — nichts wurde geändert. Erneut versuchen.",
             "Modification non enregistrée — rien n'a changé. Réessayez.")}
        </div>
      )}

      {tabs.length > 1 && (
        <div className="bvb-tabs" style={{ marginBottom: 14 }}>
          <style>{".bvb-tabs .bvk-seg button{white-space:nowrap}@media (max-width:640px){.bvb-tabs .bvk-seg button{padding:6px 10px}}"}</style>
          <Seg value={tab} onChange={setView} options={tabs} />
        </div>
      )}

      {tab === "open" && (openBatches.length === 0 ? (
        <Card><Empty>{T("No open batches yet — create one to start assigning candidates.", "Noch keine offenen Batches — erstelle einen, um Kandidaten zuzuweisen.", "Aucun lot ouvert — créez-en un pour assigner des candidats.")}</Empty></Card>
      ) : (
        <Paged items={openBatches} per={6} perPhone={4}>
          {(slice) => (
            <Card style={{ padding: "2px 18px" }}>
              {slice.map((b, i) => {
                const members = candidates.filter((c) => c.batchId === b.id);
                const pct = b.seats > 0 ? Math.min(100, Math.round((b.filled / b.seats) * 100)) : 0;
                const full = b.filled >= b.seats;
                return (
                  <div key={b.id} style={{ padding: "14px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--w)" }}>{b.name}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 12px", marginTop: 2, fontSize: 12.5, color: "var(--w3)" }}>
                          {(b.agency || b.employer) && <span>{[b.agency, b.employer].filter(Boolean).join(" → ")}</span>}
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarRange size={12} /> {fmtWindow(b)}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, flex: "none" }}>
                        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{b.filled}</span>
                        <span style={{ fontSize: 13, color: "var(--w3)" }}>/ {b.seats}</span>
                      </div>
                    </div>
                    {/* seat fill bar */}
                    <div style={{ marginTop: 10, height: 6, borderRadius: 999, overflow: "hidden", background: "var(--bg2)" }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: full ? STATUS_DOT.approved : "var(--w2)" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 12.5, color: "var(--w3)" }}>
                        {b.filled < b.seats ? T(`Funnel ${b.seats - b.filled} more to fill this intake.`, `Noch ${b.seats - b.filled} Kandidaten für dieses Intake.`, `Encore ${b.seats - b.filled} à trouver pour ce lot.`) : ""}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
                        <Btn kind="ghost" size="sm" onClick={() => setOpenBatchId(b.id)} disabled={members.length === 0}>
                          <Users size={13} /> {members.length}
                        </Btn>
                        <Btn kind="quiet" size="sm" onClick={() => closeBatch(b.id)}>{T("Close", "Schließen", "Clôturer")}</Btn>
                      </span>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </Paged>
      ))}

      {tab === "nobatch" && (
        <>
          <div style={{ fontSize: 12.5, color: "var(--w3)", margin: "0 0 8px 2px" }}>{T("On the funnel — not in a batch yet", "Im Funnel — noch keinem Batch zugewiesen", "Dans le funnel — pas encore dans un lot")}</div>
          <Paged items={onFunnelNoBatch} per={9} perPhone={5}>
            {(slice) => <Card style={{ padding: "4px 18px" }}>{slice.map((c, i) => candRow(c, i))}</Card>}
          </Paged>
        </>
      )}

      {tab === "add" && (
        <>
          <div style={{ fontSize: 12.5, color: "var(--w3)", margin: "0 0 8px 2px" }}>
            {T("Add a candidate to the funnel", "Kandidat zum Funnel hinzufügen", "Ajouter un candidat au funnel")} — {T("Pick a stage to start tracking them.", "Wähle eine Phase, um sie zu verfolgen.", "Choisissez une étape pour les suivre.")}
          </div>
          <Paged items={notOnFunnel} per={9} perPhone={6}>
            {(slice) => (
              <Card style={{ padding: "4px 18px" }}>
                {slice.map((c, i) => (
                  <div key={c.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <span style={{ fontSize: 14, color: "var(--w2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    {/* Uncontrolled, so the reload can't reset it — put it back by hand if the save was refused. */}
                    <select defaultValue="" onChange={(e) => { const el = e.target; if (el.value) void patchCand(c.userId, { stage: el.value }).then((ok) => { if (!ok) el.value = ""; }); }}
                      className="bvk-input" style={{ ...selectSt, flex: "none" }}>
                      <option value="">{T("add to funnel…", "hinzufügen…", "ajouter…")}</option>
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                ))}
              </Card>
            )}
          </Paged>
        </>
      )}

      {/* one batch's candidates — the universal popup */}
      <Modal open={!!shown} onClose={() => setOpenBatchId(null)} size="md" chromeless>
        {shown && (
          <div style={{ padding: 22 }}>
            <PopHead title={shown.name} sub={`${[shown.agency, shown.employer].filter(Boolean).join(" → ")}${shown.agency || shown.employer ? " · " : ""}${fmtWindow(shown)} · ${shown.filled}/${shown.seats}`}
              onClose={() => setOpenBatchId(null)} closeLabel={T("Close", "Schließen", "Fermer")} />
            {saveFailed && (
              <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
                {T("Couldn't save that change — nothing was changed. Try again.",
                   "Änderung konnte nicht gespeichert werden — nichts wurde geändert. Erneut versuchen.",
                   "Modification non enregistrée — rien n'a changé. Réessayez.")}
              </div>
            )}
            {candidates.filter((c) => c.batchId === shown.id).length === 0
              ? <Empty>{T("No candidates in this batch.", "Keine Kandidaten in diesem Batch.", "Aucun candidat dans ce lot.")}</Empty>
              : (
                <Paged items={candidates.filter((c) => c.batchId === shown.id)} per={8} perPhone={6}>
                  {(slice) => <div>{slice.map((c, i) => candRow(c, i))}</div>}
                </Paged>
              )}
          </div>
        )}
      </Modal>

      {/* new batch — the universal popup */}
      <Modal open={showNew} onClose={() => !saving && setShowNew(false)} size="sm" busy={saving} chromeless>
        <div style={{ padding: 22 }}>
          <PopHead title={T("New batch", "Neuer Batch", "Nouveau lot")}
            sub={T("An employer intake, e.g. \"UKSH — Q2 2026\".", "Ein Arbeitgeber-Intake, z.B. \"UKSH — Q2 2026\".", "Un recrutement employeur, p.ex. \"UKSH — Q2 2026\".")}
            onClose={() => setShowNew(false)} closeLabel={T("Close", "Schließen", "Fermer")} disabled={saving} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label={T("Name", "Name", "Nom")}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UKSH — Q2 2026" className="bvk-input" />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 110, flex: "none" }}>
                <Field label={T("Seats", "Plätze", "Places")}>
                  <input type="number" min={1} max={1000} value={form.seats} onChange={(e) => setForm({ ...form, seats: Math.max(1, Number(e.target.value) || 1) })} className="bvk-input" />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={T("Employer", "Arbeitgeber", "Employeur")}>
                  <select value={form.employerId} onChange={(e) => setForm({ ...form, employerId: e.target.value })} className="bvk-input">
                    <option value="">{T("— none —", "— keiner —", "— aucun —")}</option>
                    {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <Field label={T("Agency (optional)", "Agentur (optional)", "Agence (optionnel)")}>
              <select value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} className="bvk-input">
                <option value="">{T("— none —", "— keine —", "— aucune —")}</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={T("Window start", "Fenster-Start", "Début fenêtre")}>
                  <input type="date" value={form.targetStart} onChange={(e) => setForm({ ...form, targetStart: e.target.value })} className="bvk-input" />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={T("Window end", "Fenster-Ende", "Fin fenêtre")}>
                  <input type="date" value={form.targetEnd} onChange={(e) => setForm({ ...form, targetEnd: e.target.value })} className="bvk-input" />
                </Field>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <Btn kind="ghost" onClick={() => setShowNew(false)} disabled={saving} style={{ flex: 1 }}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
            <Btn kind="primary" onClick={createBatch} disabled={saving || !form.name.trim()} style={{ flex: 1 }}>{T("Create", "Erstellen", "Créer")}</Btn>
          </div>
        </div>
      </Modal>
    </main>
  );
}

/** popup head in the one look: serif title, quiet sub, round close */
function PopHead({ title, sub, onClose, closeLabel, disabled }: { title: string; sub?: string; onClose: () => void; closeLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)", overflowWrap: "anywhere" }}>{title}</h2>
        {sub && <div style={{ marginTop: 3, fontSize: 12.5, color: "var(--w3)" }}>{sub}</div>}
      </div>
      <button type="button" onClick={onClose} disabled={disabled} aria-label={closeLabel}
        style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", flex: "none", fontFamily: "inherit" }}>✕</button>
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}
