"use client";

/**
 * Living journey map — every candidate as an avatar-dot travelling the
 * Morocco → Germany rail. Each of the 11 journey milestones is a "station";
 * a candidate sits at their current (first not-done) station, ringed by their
 * health color. Finished candidates land at the 🇩🇪 finish.
 *
 * Pure presentation: it consumes the SAME rows the Pipeline board already
 * fetched (no extra API, no cost). Click a dot → open that candidate.
 */

import { useMemo, useState } from "react";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { B2_STAGES, b2StageColor, b2StageLabel, normalizeB2Stage, type B2Stage } from "@/lib/b2Journey";

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; daysToDue: number | null; blocked: boolean } | null;
  overdueCount: number; blockedCount: number; health: Health;
  parallel?: { key: string; done: boolean }[];
};
export type MapRow = { userId: string; name: string; photo: string | null; status: Status; sellable?: { sellable: boolean }; b2Stage?: string };

const HEALTH_COLOR: Record<Health, string> = {
  blocked: "#ef4444", overdue: "#f97316", due_soon: "#f59e0b", on_track: "#16a34a", done: "#6b7280",
};

function initials(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

export function JourneyMap({
  rows, lang, onPick,
}: {
  rows: MapRow[];
  lang: string;
  onPick: (userId: string) => void;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [hover, setHover] = useState<string | null>(null);

  // Stations = the 11 presets in order, plus an implicit "arrived" finish.
  const stations = useMemo(
    () => JOURNEY_PRESETS.slice().sort((a, b) => a.position - b.position),
    [],
  );

  // Group candidates by their current station key (done → "__done__").
  const byStation = useMemo(() => {
    const m = new Map<string, MapRow[]>();
    for (const r of rows) {
      const key = r.status.current ? r.status.current.key : "__done__";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [rows]);

  const stationLabel = (key: string) => {
    const p = JOURNEY_PRESETS.find((x) => x.key === key);
    if (!p) return key;
    return p.label[(lang as "en" | "fr" | "de")] ?? p.label.en;
  };

  const Dot = ({ r, showB2 = false }: { r: MapRow; showB2?: boolean }) => {
    const color = HEALTH_COLOR[r.status.health];
    const isHover = hover === r.userId;
    const b2Stage = normalizeB2Stage(r.b2Stage);
    return (
      <button
        onMouseEnter={() => setHover(r.userId)} onMouseLeave={() => setHover((h) => (h === r.userId ? null : h))}
        onClick={() => onPick(r.userId)}
        title={r.name}
        style={{
          position: "relative", flexShrink: 0, width: 30, height: 30, borderRadius: 999, padding: 0, cursor: "pointer",
          border: `2px solid ${color}`, background: "var(--bg2)", overflow: "visible",
          boxShadow: isHover ? `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)` : "none",
          transition: "box-shadow .15s, transform .15s", transform: isHover ? "scale(1.15)" : "scale(1)", zIndex: isHover ? 5 : 1,
        }}
      >
        {r.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.photo} alt="" style={{ width: "100%", height: "100%", borderRadius: 999, objectFit: "cover" }} />
        ) : (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: 10, fontWeight: 700, color }}>
            {initials(r.name)}
          </span>
        )}
        {/* blocked badge */}
        {r.status.health === "blocked" && (
          <span style={{ position: "absolute", top: -3, right: -3, width: 10, height: 10, borderRadius: 999, background: "#ef4444", border: "1.5px solid var(--card)" }} />
        )}
        {/* ready-to-sell gold dot (bottom-right) */}
        {r.sellable?.sellable && (
          <span style={{ position: "absolute", bottom: -3, right: -3, width: 11, height: 11, borderRadius: 999, background: "var(--gold)", border: "1.5px solid var(--card)" }} title="Ready to sell" />
        )}
        {/* B2 sub-stage badge — ONLY rendered inside the dedicated B2 mini-rail
            (showB2). The main Morocco→Germany rail stays clean: just the person
            + their health ring, no B2 clutter on every avatar. */}
        {showB2 && b2Stage !== "not_started" && (
          <span title={`B2: ${b2StageLabel(b2Stage, lang)}`}
            style={{ position: "absolute", bottom: -3, left: -3, width: 12, height: 12, borderRadius: 999,
              border: "1.5px solid var(--card)", background: b2StageColor(b2Stage),
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6, fontWeight: 800, color: "#fff" }}>
            {b2Stage === "passed" ? "✓" : ""}
          </span>
        )}
        {isHover && (
          <span style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
            whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
            background: "var(--card)", color: "var(--w)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 10,
          }}>
            {r.name}
          </span>
        )}
      </button>
    );
  };

  const doneRows = byStation.get("__done__") ?? [];

  return (
    <div className="bv-card" style={{ padding: "18px 16px", overflow: "hidden" }}>
      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16, fontSize: 11.5, color: "var(--w3)" }}>
        <span style={{ fontWeight: 700, color: "var(--w)" }}>🇲🇦 {T("Morocco", "Marokko", "Maroc")}</span>
        <span style={{ flex: 1, minWidth: 20, height: 2, background: "linear-gradient(90deg, var(--border), var(--gold))", borderRadius: 2 }} />
        <span style={{ fontWeight: 700, color: "var(--w)" }}>{T("Germany", "Deutschland", "Allemagne")} 🇩🇪</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        {(["blocked", "overdue", "due_soon", "on_track", "done"] as Health[]).map((h) => (
          <span key={h} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--w3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: HEALTH_COLOR[h] }} />
            {h === "blocked" ? T("Blocked", "Blockiert", "Bloqué")
              : h === "overdue" ? T("Overdue", "Überfällig", "En retard")
              : h === "due_soon" ? T("Due soon", "Bald fällig", "Bientôt")
              : h === "on_track" ? T("On track", "Im Plan", "Sur la voie")
              : T("Arrived", "Angekommen", "Arrivé")}
          </span>
        ))}
      </div>

      {/* The rail: one row per station, candidates clustered at it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {stations.map((st, i) => {
          const here = byStation.get(st.key) ?? [];
          const last = i === stations.length - 1;
          return (
            <div key={st.key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* Rail spine + node */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
                <span style={{ width: 13, height: 13, borderRadius: 999, marginTop: 4,
                  background: here.length ? "var(--gold)" : "var(--bg2)", border: `2px solid ${here.length ? "var(--gold)" : "var(--border)"}` }} />
                {!last && <span style={{ flex: 1, width: 2, minHeight: 30, background: "var(--border)" }} />}
              </div>
              {/* Station label + the candidate dots parked here */}
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: here.length ? 8 : 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: here.length ? "var(--w)" : "var(--w3)" }}>{stationLabel(st.key)}</span>
                  {here.length > 0 && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "var(--gdim)", color: "var(--gold)" }}>{here.length}</span>
                  )}
                </div>
                {here.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {here.map((r) => <Dot key={r.userId} r={r} />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Finish line — arrived in Germany */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, flexShrink: 0 }}>
            <span style={{ fontSize: 15, marginTop: -2 }}>🇩🇪</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: doneRows.length ? 8 : 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>{T("Arrived in Germany", "In Deutschland angekommen", "Arrivé en Allemagne")}</span>
              {doneRows.length > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "rgba(22,163,74,0.15)", color: "#16a34a" }}>{doneRows.length}</span>
              )}
            </div>
            {doneRows.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {doneRows.map((r) => <Dot key={r.userId} r={r} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "1rem 0" }}>
          {T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}
        </p>
      )}

      {/* ── B2 sub-journey mini-rail — a second roadmap, parallel to the main one.
            Candidates cluster at their current B2 micro-stage; the 'partial'
            stage visibly loops back to 'booked'. ─────────────────────────────── */}
      {(() => {
        const b2Rows = rows.filter((r) => normalizeB2Stage(r.b2Stage) !== "not_started");
        if (b2Rows.length === 0) return null;
        const byB2 = new Map<B2Stage, MapRow[]>();
        for (const r of b2Rows) {
          const st = normalizeB2Stage(r.b2Stage);
          const arr = byB2.get(st) ?? []; arr.push(r); byB2.set(st, arr);
        }
        const stages = B2_STAGES.filter((s) => s.key !== "not_started");
        return (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px dashed var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--w)" }}>🇩🇪 {T("B2 German — sub-journey", "B2 Deutsch — Teilreise", "B2 allemand — sous-parcours")}</span>
              <span style={{ fontSize: 11, color: "var(--w3)" }}>{T("(runs in parallel)", "(läuft parallel)", "(en parallèle)")}</span>
            </div>
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
              {stages.map((st, i) => {
                const here = byB2.get(st.key) ?? [];
                return (
                  <div key={st.key} style={{ flex: "1 0 130px", minWidth: 130, display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* node + connector */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 999, background: here.length ? st.color : "var(--bg2)", border: `2px solid ${here.length ? st.color : "var(--border)"}`, flexShrink: 0 }} />
                      {i < stages.length - 1 && <span style={{ flex: 1, height: 2, background: "var(--border)" }} />}
                      {/* the partial → booked loop hint */}
                      {st.key === "partial" && <span title={T("loops back to re-book", "zurück zum Buchen", "retour à la réservation")} style={{ fontSize: 12, color: st.color }}>↩</span>}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: here.length ? "var(--w)" : "var(--w3)", lineHeight: 1.2 }}>
                      {st.label[(lang as "en" | "fr" | "de")] ?? st.label.en}
                      {here.length > 0 && <span style={{ marginLeft: 5, color: st.color }}>{here.length}</span>}
                    </div>
                    {here.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {here.map((r) => <Dot key={r.userId} r={r} showB2 />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
