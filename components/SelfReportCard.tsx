"use client";

/**
 * Candidate self-report card — the friendly "log your progress" surface on the
 * candidate dashboard. One tap to tell the team a milestone (passed / didn't
 * pass B2, passed / didn't pass / scheduled an interview, or a free note) so
 * they don't have to chase and re-key it. Self-contained: fetches the caller's
 * own recent reports + posts via /api/portal/self-report.
 */

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { relativeTimeShort } from "@/lib/relativeTime";

type Report = { id: string; kind: string; outcome: string; note: string | null; created_at: string };
type Tone = "neutral" | "good" | "bad";

function Btn({ onClick, children, busy, tone = "neutral" }: { onClick: () => void; children: ReactNode; busy: boolean; tone?: Tone }) {
  const style =
    tone === "good" ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }
    : tone === "bad" ? { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }
    : { background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" };
  return (
    <button onClick={onClick} disabled={busy}
      className="bv-press text-[12.5px] font-semibold px-3 py-2 rounded-xl disabled:opacity-50"
      style={style}>
      {children}
    </button>
  );
}

export function SelfReportCard({ lang }: { lang: string }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

  const load = async () => {
    try {
      const t = await getToken();
      const r = await fetch("/api/portal/self-report", { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) { const j = await r.json(); setReports((j.reports ?? []) as Report[]); }
    } catch { /* keep existing */ }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const log = async (kind: string, outcome: string, note?: string) => {
    setBusy(true);
    try {
      const t = await getToken();
      const r = await fetch("/api/portal/self-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ kind, outcome, note }),
      });
      if (r.ok) {
        setDone(true); setNoteOpen(false); setNoteText("");
        await load();
        setTimeout(() => setDone(false), 2600);
      }
    } catch { /* swallow */ }
    setBusy(false);
  };

  const labelFor = (rep: Report) => {
    if (rep.kind === "b2") return rep.outcome === "passed" ? T("Passed B2 🎉", "B2 bestanden 🎉", "B2 réussi 🎉") : T("Didn't pass B2 — retaking", "B2 nicht bestanden", "B2 non réussi");
    if (rep.kind === "interview") return rep.outcome === "passed" ? T("Passed an interview ✅", "Gespräch bestanden ✅", "Entretien réussi ✅")
      : rep.outcome === "scheduled" ? T("Interview scheduled 📅", "Gespräch geplant 📅", "Entretien planifié 📅")
      : T("Interview didn't pass", "Gespräch nicht bestanden", "Entretien non réussi");
    return rep.note || T("Update", "Update", "Mise à jour");
  };

  return (
    <div className="overflow-hidden mb-4" style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div className="px-6 pt-5 pb-4">
        <p className="text-[15px] font-bold tracking-[-0.01em] mb-0.5" style={{ color: "var(--w)" }}>{T("Log your progress 👋", "Fortschritt melden 👋", "Signale ton avancement 👋")}</p>
        <p className="text-[12px] mb-4" style={{ color: "var(--w3)" }}>{T("Tell us your latest step — it helps us move you faster.", "Sag uns deinen letzten Schritt — so geht es schneller.", "Dis-nous ta dernière étape — on avance plus vite.")}</p>

        {done && (
          <div className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold mb-3 px-3 py-1.5 rounded-full" style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>✓ {T("Thanks — we got it!", "Danke — erhalten!", "Merci — bien reçu !")}</div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T("B2 exam", "B2-Prüfung", "Examen B2")}</p>
            <div className="flex flex-wrap gap-2">
              <Btn busy={busy} tone="good" onClick={() => log("b2", "passed")}>{T("I passed B2 🎉", "B2 bestanden 🎉", "J'ai réussi le B2 🎉")}</Btn>
              <Btn busy={busy} tone="bad" onClick={() => log("b2", "failed")}>{T("Didn't pass — retake ↺", "Nicht bestanden ↺", "Échoué — reprise ↺")}</Btn>
            </div>
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T("Interview", "Gespräch", "Entretien")}</p>
            <div className="flex flex-wrap gap-2">
              <Btn busy={busy} tone="good" onClick={() => log("interview", "passed")}>{T("Passed ✅", "Bestanden ✅", "Réussi ✅")}</Btn>
              <Btn busy={busy} tone="bad" onClick={() => log("interview", "failed")}>{T("Didn't pass ✗", "Nicht bestanden ✗", "Échoué ✗")}</Btn>
              <Btn busy={busy} onClick={() => log("interview", "scheduled")}>{T("Scheduled 📅", "Geplant 📅", "Planifié 📅")}</Btn>
            </div>
          </div>
          <div>
            {!noteOpen ? (
              <Btn busy={busy} onClick={() => setNoteOpen(true)}>{T("Something else ✏️", "Etwas anderes ✏️", "Autre chose ✏️")}</Btn>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={280} rows={2}
                  className="bv-input" placeholder={T("Type your update…", "Schreib dein Update…", "Écris ta mise à jour…")} style={{ fontSize: 12.5, resize: "none" }} />
                <div className="flex gap-2">
                  <Btn busy={busy} tone="good" onClick={() => { if (noteText.trim()) void log("other", "note", noteText.trim()); }}>{T("Send", "Senden", "Envoyer")}</Btn>
                  <button onClick={() => { setNoteOpen(false); setNoteText(""); }} className="bv-press text-[12px] px-3 py-2" style={{ color: "var(--w3)" }}>{T("Cancel", "Abbrechen", "Annuler")}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {reports.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{T("Your recent updates", "Deine letzten Updates", "Tes dernières mises à jour")}</p>
            <div className="flex flex-col gap-1.5">
              {reports.slice(0, 4).map((rep) => (
                <div key={rep.id} className="flex items-center justify-between gap-2 text-[12px]" style={{ color: "var(--w2)" }}>
                  <span className="truncate">{labelFor(rep)}</span>
                  <span className="flex-shrink-0" style={{ color: "var(--w3)", fontSize: 11 }}>{relativeTimeShort(rep.created_at, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
