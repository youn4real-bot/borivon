"use client";

/**
 * Interview self-scheduler — candidate picker (self-contained).
 *
 * Mounted once on the candidate dashboard. Fetches the caller's OPEN interview
 * proposals, shows a gold banner per proposal, and opens a modal to pick a time.
 * Also honours the ?interview=<id> deep-link from the bell (auto-opens + strips
 * the param). Picking POSTs /api/portal/me/interview-pick, which records the
 * confirmed date in the pipeline. Renders nothing when there's nothing to pick.
 */
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/components/LangContext";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { CalendarClock, Check } from "lucide-react";

type Proposal = { id: string; round: number; slots: string[]; note: string };

export function InterviewPicker({ authToken }: { authToken: string | null }) {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // Reactive to CLIENT-SIDE url changes. Reading window.location.search once on
  // mount silently failed for the COMMON case: the candidate is already sitting
  // on the dashboard, taps the bell, Next re-routes without remounting → the
  // picker never opened.
  const searchParams = useSearchParams();

  const load = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch("/api/portal/me/interview-proposals", { headers: { Authorization: `Bearer ${authToken}` } });
      const j = await res.json().catch(() => ({}));
      setProposals((j.proposals ?? []) as Proposal[]);
    } catch { /* keep */ }
  }, [authToken]);

  useEffect(() => { load(); }, [load]);

  // Bell deep-link: ?interview=<id> auto-opens that proposal, then strips the param.
  useEffect(() => {
    if (typeof window === "undefined" || proposals.length === 0) return;
    const id = searchParams.get("interview");
    if (id && proposals.some((p) => p.id === id)) {
      setOpenId(id); setChosen(""); setErr("");
      const url = new URL(window.location.href); url.searchParams.delete("interview"); window.history.replaceState({}, "", url.toString());
    }
  }, [proposals, searchParams]);

  const active = proposals.find((p) => p.id === openId) ?? null;

  const submit = async () => {
    if (!active || !chosen || !authToken || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/portal/me/interview-pick", {
        method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: active.id, slot: chosen }),
      });
      if (res.ok) { setDone(chosen); setOpenId(null); setChosen(""); await load(); return; }
      // NEVER fail silently — a candidate tapping Confirm with nothing happening
      // assumes the portal is broken and messages the founder instead of booking.
      if (res.status === 409) {
        setErr(T("This was already handled — refreshing.", "Bereits erledigt — wird aktualisiert.", "Déjà traité — actualisation."));
        await load();
      } else if (res.status === 401) {
        setErr(T("Your session expired — please reload the page.", "Sitzung abgelaufen — bitte Seite neu laden.", "Session expirée — rechargez la page."));
      } else {
        setErr(T("Could not confirm — please try again.", "Konnte nicht bestätigen — bitte erneut versuchen.", "Impossible de confirmer — réessayez."));
      }
    } catch {
      setErr(T("Connection problem — please try again.", "Verbindungsproblem — bitte erneut versuchen.", "Problème de connexion — réessayez."));
    } finally { setBusy(false); }
  };

  const fmt = (s: string) => {
    const [d, t] = s.split("T");
    const dt = new Date(`${d}T${t || "00:00"}`);
    if (isNaN(dt.getTime())) return s;
    return dt.toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (proposals.length === 0 && !done) return null;

  return (
    <>
      {proposals.map((p) => (
        <button key={p.id} onClick={() => { setOpenId(p.id); setChosen(""); }}
          className="w-full text-left mb-3 p-3.5 flex items-center gap-3 transition-opacity hover:opacity-90"
          style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", borderRadius: 14 }}>
          <CalendarClock size={18} style={{ color: "var(--gold)" }} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold" style={{ color: "var(--w)" }}>
              {T(`Pick your interview time — Interview ${p.round}`, `Interview-Termin wählen — Interview ${p.round}`, `Choisissez votre entretien — Entretien ${p.round}`)}
            </span>
            <span className="block text-[11.5px]" style={{ color: "var(--w3)" }}>
              {T(`${p.slots.length} time${p.slots.length > 1 ? "s" : ""} offered — tap to choose`, `${p.slots.length} Termine — tippen zum Wählen`, `${p.slots.length} créneaux — touchez pour choisir`)}
            </span>
          </span>
        </button>
      ))}

      {done && (
        <div className="mb-3 p-3.5 flex items-center gap-2.5" style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.35)", borderRadius: 14 }}>
          <Check size={16} style={{ color: "#16a34a" }} strokeWidth={2.6} />
          <span className="text-[12.5px]" style={{ color: "var(--w2)" }}>
            {T("Interview time confirmed:", "Interview-Termin bestätigt:", "Entretien confirmé :")} <b style={{ color: "var(--w)" }}>{fmt(done)}</b>
          </span>
        </div>
      )}

      <Modal open={!!active} onClose={() => !busy && setOpenId(null)} size="sm" busy={busy}
        title={T("Choose your interview time", "Interview-Termin wählen", "Choisissez votre entretien")}
        subtitle={active?.note || T("Tap the time that works for you.", "Tippe auf den passenden Termin.", "Touchez le créneau qui vous convient.")}
        footer={<><GhostButton onClick={() => setOpenId(null)} disabled={busy}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={submit} disabled={busy || !chosen}>{T("Confirm", "Bestätigen", "Confirmer")}</GoldButton></>}>
        <div className="px-5 py-4 space-y-2">
          {err && (
            <p className="text-[12.5px] mb-1 px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>
              {err}
            </p>
          )}
          {(active?.slots ?? []).map((s) => {
            const sel = chosen === s;
            return (
              <button key={s} onClick={() => setChosen(s)}
                className="w-full text-left px-3.5 py-3 rounded-xl flex items-center gap-2.5 transition-colors"
                style={{ background: sel ? "var(--gdim)" : "var(--bg2)", border: `1px solid ${sel ? "var(--border-gold)" : "var(--border)"}`, color: sel ? "var(--gold)" : "var(--w2)" }}>
                <span style={{ width: 16, height: 16, borderRadius: 999, border: `2px solid ${sel ? "var(--gold)" : "var(--w3)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {sel && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--gold)" }} />}
                </span>
                <span className="text-[13.5px] font-semibold">{fmt(s)}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
