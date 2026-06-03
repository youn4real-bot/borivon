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
import { B2_MAIN_STAGES, B2_STAGE_BY_KEY, normalizeB2Stage, type B2Stage } from "@/lib/b2Journey";
import { IMPFUNG_STAGES, type ImpfungStage } from "@/lib/impfungJourney";

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; daysToDue: number | null; blocked: boolean } | null;
  reached: { key: string; position: number } | null;
  overdueCount: number; blockedCount: number; health: Health;
  parallel?: { key: string; done: boolean }[];
};
export type MapRow = { userId: string; name: string; photo: string | null; status: Status; sellable?: { sellable: boolean }; b2Stage?: string; impfungStage?: string; impfungDoses?: { got: number; need: number } };

const HEALTH_COLOR: Record<Health, string> = {
  blocked: "#ef4444", overdue: "#f97316", due_soon: "#f59e0b", on_track: "#16a34a", done: "#6b7280",
};

function initials(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

export type MapTrack = "journey" | "b2" | "impfung";

export function JourneyMap({
  rows, lang, onPick, track = "journey",
}: {
  rows: MapRow[];
  lang: string;
  onPick: (userId: string) => void;
  /** Which roadmap to show: the main Morocco→Germany journey, or the B2 track. */
  track?: MapTrack;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [hover, setHover] = useState<string | null>(null);

  // Stations = the 11 presets in order, plus an implicit "arrived" finish.
  const stations = useMemo(
    () => JOURNEY_PRESETS.slice().sort((a, b) => a.position - b.position),
    [],
  );

  // Group candidates by the FURTHEST station they've REACHED (last completed),
  // so an avatar visibly "moves in" to a station once they pass it. Buckets:
  //   "__start__" = nothing completed yet (sit at the very beginning)
  //   "__done__"  = fully arrived (all stations + B2 done)
  //   <preset key> = parked at the last station they completed
  const byStation = useMemo(() => {
    const m = new Map<string, MapRow[]>();
    for (const r of rows) {
      const key = r.status.health === "done"
        ? "__done__"
        : r.status.reached
        ? r.status.reached.key
        : "__start__";
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return m;
  }, [rows]);

  const stationLabel = (key: string) => {
    const p = JOURNEY_PRESETS.find((x) => x.key === key);
    if (!p) return key;
    return p.label[(lang as "en" | "fr" | "de")] ?? p.label.en;
  };

  // B2 certificate track: group candidates by their B2 stage. Main path stages
  // render on the left; the 'retaking' failure branch sits on the right and is
  // only shown when someone is actually in it.
  const b2 = useMemo(() => {
    const by = new Map<B2Stage, MapRow[]>();
    for (const r of rows) {
      const st = normalizeB2Stage(r.b2Stage);
      (by.get(st) ?? by.set(st, []).get(st)!).push(r);
    }
    const onPath = rows.length - (by.get("not_started")?.length ?? 0);
    return { by, onPath };
  }, [rows]);

  const Dot = ({ r }: { r: MapRow }) => {
    const color = HEALTH_COLOR[r.status.health];
    const isHover = hover === r.userId;
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
        {/* The avatar is intentionally CLEAN — nothing overlaid on it. Status is
            conveyed by the RING colour only (blocked = red ring). B2 stage is
            shown by which column a candidate sits in within the B2 mini-rail
            (grouping = the signal), and "ready to sell" lives in the list view +
            hero. Per design: the face stands alone. */}
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

  // ── B2 TRACK — a dedicated full roadmap (same vertical-rail style as the
  // journey). Candidates cluster at their current B2 stage; the partial/re-book
  // failure stage shows only when someone is actually in it. ──────────────────
  if (track === "b2") {
    const notStarted = b2.by.get("not_started") ?? [];
    const retaking = b2.by.get("retaking") ?? [];
    const retakeDef = B2_STAGE_BY_KEY["retaking"];
    // One vertical-rail row (reused for not-started + each main stage).
    const Row = ({ color, label, here, last }: { color: string; label: string; here: MapRow[]; last?: boolean }) => (
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
          <span style={{ width: 13, height: 13, borderRadius: 999, marginTop: 4, background: here.length ? color : "var(--bg2)", border: `2px solid ${here.length ? color : "var(--border)"}` }} />
          {!last && <span style={{ flex: 1, width: 2, minHeight: 28, background: "var(--border)" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: here.length ? 8 : 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: here.length ? "var(--w)" : "var(--w3)" }}>{label}</span>
            {here.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>{here.length}</span>}
          </div>
          {here.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{here.map((r) => <Dot key={r.userId} r={r} />)}</div>}
        </div>
      </div>
    );
    return (
      <div className="bv-card" style={{ padding: "18px 16px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--w)" }}>📜 {T("B2 German — certificate pathway", "B2 Deutsch — Zertifikatsweg", "B2 allemand — parcours de certification")}</span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--w3)", marginBottom: 16 }}>
          {T("Runs in parallel to the main journey.", "Läuft parallel zur Hauptreise.", "En parallèle du parcours principal.")}
          {b2.onPath > 0 ? ` · ${b2.onPath}/${rows.length} ${T("on the pathway", "auf dem Weg", "sur le parcours")}` : ""}
        </p>
        {/* Two columns: LEFT = main path (studying→planning→booked→passed);
            RIGHT = retaking branch (failed/partial), only when someone's in it. */}
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* LEFT — main path */}
          <div style={{ flex: "1 1 340px", minWidth: 300, display: "flex", flexDirection: "column" }}>
            <Row color="var(--border)" label={T("Not started yet", "Noch nicht begonnen", "Pas encore commencé")} here={notStarted} />
            {B2_MAIN_STAGES.map((s, i) => (
              <Row key={s.key} color={s.color} label={s.label[(lang as "en" | "fr" | "de")] ?? s.label.en}
                here={b2.by.get(s.key) ?? []} last={i === B2_MAIN_STAGES.length - 1} />
            ))}
          </div>
          {/* RIGHT — retaking branch, only if anyone failed/partial */}
          {retaking.length > 0 && (
            <div style={{ flex: "0 1 260px", minWidth: 220, padding: "12px 14px", borderRadius: 12, background: "color-mix(in srgb, #f97316 8%, transparent)", border: "1px solid color-mix(in srgb, #f97316 35%, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 11, height: 11, borderRadius: 999, background: retakeDef.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#f97316" }}>↩ {retakeDef.label[(lang as "en" | "fr" | "de")] ?? retakeDef.label.en}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "color-mix(in srgb, #f97316 18%, transparent)", color: "#f97316" }}>{retaking.length}</span>
              </div>
              <p style={{ fontSize: 10.5, color: "var(--w3)", marginBottom: 10 }}>{T("Didn't pass — a new exam date is booked to try again.", "Nicht bestanden — neuer Termin gebucht.", "Échoué — nouvelle date réservée.")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{retaking.map((r) => <Dot key={r.userId} r={r} />)}</div>
            </div>
          )}
        </div>
        {rows.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "1rem 0" }}>{T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}</p>
        )}
      </div>
    );
  }

  // ── IMPFUNG TRACK — vaccination pathway. Only candidates whose agency requires
  // vaccines appear (others are "not_required"). Same vertical-rail style. ──────
  if (track === "impfung") {
    const byImpf = new Map<ImpfungStage, MapRow[]>();
    for (const r of rows) {
      const st = (r.impfungStage ?? "not_required") as ImpfungStage;
      if (st === "not_required" || st === "not_started") continue;
      (byImpf.get(st) ?? byImpf.set(st, []).get(st)!).push(r);
    }
    // Required but not yet started — shown as the first row so the WHOLE required
    // cohort is visible (every avatar), not just those mid-pathway.
    const notStartedImpf = rows.filter((r) => r.impfungStage === "not_started");
    const onPath = [...byImpf.values()].reduce((n, a) => n + a.length, 0);
    const requiredCount = rows.filter((r) => r.impfungStage && r.impfungStage !== "not_required").length;
    return (
      <div className="bv-card" style={{ padding: "18px 16px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--w)" }}>💉 {T("Impfung — vaccination pathway", "Impfung — Impfweg", "Vaccination — parcours")}</span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--w3)", marginBottom: 16 }}>
          {T("Only candidates whose agency requires vaccines.", "Nur Kandidaten, deren Agentur Impfungen verlangt.", "Seuls les candidats dont l'agence exige des vaccins.")}
          {requiredCount > 0 ? ` · ${onPath}/${requiredCount} ${T("started", "begonnen", "commencés")}` : ""}
        </p>
        {requiredCount === 0 ? (
          <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "1rem 0" }}>
            {T("No candidate's agency requires Impfung yet.", "Keine Agentur verlangt aktuell Impfungen.", "Aucune agence n'exige de vaccination pour l'instant.")}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Required but not started — shows the rest of the required cohort. */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
                <span style={{ width: 13, height: 13, borderRadius: 999, marginTop: 4, background: "var(--bg2)", border: "2px solid var(--border)" }} />
                <span style={{ flex: 1, width: 2, minHeight: 28, background: "var(--border)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: notStartedImpf.length ? 8 : 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: notStartedImpf.length ? "var(--w)" : "var(--w3)" }}>{T("Required — not started", "Erforderlich — nicht begonnen", "Requis — pas commencé")}</span>
                  {notStartedImpf.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "var(--gdim)", color: "var(--gold)" }}>{notStartedImpf.length}</span>}
                </div>
                {notStartedImpf.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{notStartedImpf.map((r) => <Dot key={r.userId} r={r} />)}</div>
                )}
              </div>
            </div>
            {IMPFUNG_STAGES.map((s, i) => {
              const here = byImpf.get(s.key) ?? [];
              const last = i === IMPFUNG_STAGES.length - 1;
              return (
                <div key={s.key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
                    <span style={{ width: 13, height: 13, borderRadius: 999, marginTop: 4, background: here.length ? s.color : "var(--bg2)", border: `2px solid ${here.length ? s.color : "var(--border)"}` }} />
                    {!last && <span style={{ flex: 1, width: 2, minHeight: 28, background: "var(--border)" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: here.length ? 8 : 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: here.length ? "var(--w)" : "var(--w3)" }}>
                        {s.label[(lang as "en" | "fr" | "de")] ?? s.label.en}
                      </span>
                      {here.length > 0 && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: `color-mix(in srgb, ${s.color} 18%, transparent)`, color: s.color }}>{here.length}</span>
                      )}
                    </div>
                    {here.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                        {here.map((r) => (
                          <span key={r.userId} style={{ position: "relative" }}>
                            <Dot r={r} />
                            {/* dose progress hint while still getting doses */}
                            {(s.key === "in_progress" || s.key === "appointment") && r.impfungDoses && r.impfungDoses.need > 0 && (
                              <span style={{ position: "absolute", bottom: -4, right: -4, fontSize: 8, fontWeight: 800, lineHeight: 1, padding: "1px 3px", borderRadius: 5, background: s.color, color: "#fff", border: "1.5px solid var(--card)" }}>
                                {r.impfungDoses.got}/{r.impfungDoses.need}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

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

      {/* The rail: one row per station, candidates clustered at the FURTHEST
          station they've reached. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {/* 🇲🇦 Start — candidates who haven't completed any station yet. */}
        {(() => {
          const startHere = byStation.get("__start__") ?? [];
          return (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
                <span style={{ fontSize: 15, marginTop: -2 }}>🇲🇦</span>
                <span style={{ flex: 1, width: 2, minHeight: 30, background: "var(--border)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: startHere.length ? 8 : 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: startHere.length ? "var(--w)" : "var(--w3)" }}>{T("Just started", "Gerade begonnen", "Vient de commencer")}</span>
                  {startHere.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "var(--gdim)", color: "var(--gold)" }}>{startHere.length}</span>}
                </div>
                {startHere.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{startHere.map((r) => <Dot key={r.userId} r={r} />)}</div>
                )}
              </div>
            </div>
          );
        })()}
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
    </div>
  );
}
