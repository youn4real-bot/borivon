"use client";

/**
 * Living journey map — every candidate as an avatar-dot travelling the
 * Morocco → Germany rail. Each of the 11 journey milestones is a "station";
 * a candidate sits at their current (first not-done) station, ringed by their
 * health color. Finished candidates land at the 🇩🇪 finish.
 *
 * Pure presentation: it consumes the SAME rows the Pipeline board already
 * fetched (no extra API, no cost). Click a dot → open that candidate.
 *
 * MOTION: avatars are `motion` elements sharing a `layoutId`, so when a
 * candidate changes stage (real-time) their face GLIDES to the new row instead
 * of popping. Faces cascade in on load, count badges spring, the red "retaking"
 * halo pulses, hover/tap feel alive. Honors prefers-reduced-motion.
 *
 * NB: Dot/Count/Cluster are MODULE-LEVEL (stable component identity) and read
 * shared state via context — defining them inside the render would give them a
 * new identity every hover, remounting every avatar and replaying the entrance
 * animation on every hover. Shared state flows through MapCtx instead.
 */

import { useMemo, useState, createContext, useContext, type ReactNode } from "react";
import { LayoutGroup, AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from "@dnd-kit/core";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { B2_STAGES, B2_FAILED_COLOR, b2StageColor, normalizeB2Stage, type B2Stage, type B2StageDef } from "@/lib/b2Journey";
import { IMPFUNG_STAGES, type ImpfungStage } from "@/lib/impfungJourney";

type Health = "on_track" | "due_soon" | "overdue" | "blocked" | "done";
type Status = {
  progress: number; doneCount: number; totalPresets: number;
  current: { key: string; daysToDue: number | null; blocked: boolean } | null;
  reached: { key: string; position: number } | null;
  overdueCount: number; blockedCount: number; health: Health;
  parallel?: { key: string; done: boolean }[];
};
export type MapRow = { userId: string; name: string; photo: string | null; status: Status; sellable?: { sellable: boolean }; b2Stage?: string; b2Failed?: boolean; impfungStage?: string; impfungDoses?: { got: number; need: number } };

const HEALTH_COLOR: Record<Health, string> = {
  blocked: "#ef4444", overdue: "#f97316", due_soon: "#f59e0b", on_track: "#16a34a", done: "#6b7280",
};

function initials(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

export type MapTrack = "journey" | "b2" | "impfung";

// One spring, reused — snappy but soft. Collapsed to instant under reduced-motion.
const SPRING = { type: "spring" as const, stiffness: 520, damping: 34, mass: 0.7 };
function trans(reduce: boolean, extra?: Record<string, number>) {
  return reduce ? { duration: 0 } : { ...SPRING, ...(extra ?? {}) };
}

// Shared per-render state for the avatar primitives (kept out of props so the
// many Dot call-sites stay clean). Changing this re-renders consumers but never
// remounts them — Dot/Count keep stable identity at module scope.
type MapCtxVal = {
  track: MapTrack;
  lang: string;
  hover: string | null;
  setHover: (id: string | null) => void;
  onPick: (userId: string) => void;
  reduce: boolean;
  /** B2 track only: avatars are draggable between stages (admin can move them). */
  canDragB2: boolean;
};
const MapCtx = createContext<MapCtxVal | null>(null);
function useMapCtx(): MapCtxVal {
  const v = useContext(MapCtx);
  if (!v) throw new Error("JourneyMap primitives used outside provider");
  return v;
}

// ── The avatar. A single motion.button so enter/exit/move/hover all animate
// uniformly. layoutId (scoped per track) makes the SAME face GLIDE to its new
// stage row when status changes. The face stays CLEAN — status is the ring
// colour only (LAW #4); an optional corner badge carries dose progress. ──────
function Dot({ r, ringColor, halo, index = 0, badge, dragRef, dragHandle, isDragging, draggable }: {
  r: MapRow; ringColor?: string; halo?: string; index?: number; badge?: ReactNode;
  // Drag wiring (B2 track only) — supplied by DraggableDot via @dnd-kit.
  dragRef?: (el: HTMLElement | null) => void; dragHandle?: Record<string, unknown>; isDragging?: boolean; draggable?: boolean;
}) {
  const { track, hover, setHover, onPick, reduce } = useMapCtx();
  const color = ringColor ?? HEALTH_COLOR[r.status.health];
  const isHover = hover === r.userId;
  const haloShadow = halo ? `0 0 0 3px ${halo}` : "";
  const hoverShadow = isHover ? `0 0 0 ${halo ? 6 : 3}px color-mix(in srgb, ${color} 35%, transparent)` : "";
  return (
    <motion.button
      ref={dragRef}
      {...(dragHandle ?? {})}
      layout="position"
      layoutId={`${track}:${r.userId}`}
      initial={reduce ? false : { opacity: 0, scale: 0 }}
      animate={{ opacity: isDragging ? 0.35 : 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0 }}
      transition={trans(reduce, { delay: reduce ? 0 : Math.min(index * 0.02, 0.45) })}
      whileHover={reduce || isDragging ? undefined : { scale: 1.18 }}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      onMouseEnter={() => setHover(r.userId)}
      onMouseLeave={() => setHover(hover === r.userId ? null : hover)}
      onClick={() => onPick(r.userId)}
      title={halo ? `${r.name} — failed B2 before (retaking)` : r.name}
      style={{
        position: "relative", flexShrink: 0, width: 30, height: 30, borderRadius: 999, padding: 0,
        cursor: draggable ? (isDragging ? "grabbing" : "grab") : "pointer",
        touchAction: draggable ? "none" : undefined,
        border: `2px solid ${color}`, background: "var(--bg2)", overflow: "visible",
        boxShadow: [hoverShadow, haloShadow].filter(Boolean).join(", ") || "none",
        zIndex: isHover ? 6 : 1,
      }}
    >
      {/* Re-takers (B2 failed once): a steady red ring (boxShadow above) PLUS a
          soft radar pulse so your eye lands on them anywhere on the rail. */}
      {halo && !reduce && (
        <motion.span
          aria-hidden
          style={{ position: "absolute", inset: -3, borderRadius: 999, border: `2px solid ${halo}`, pointerEvents: "none" }}
          animate={{ scale: [1, 1.28, 1], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {r.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photo} alt="" style={{ width: "100%", height: "100%", borderRadius: 999, objectFit: "cover" }} />
      ) : (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: 10, fontWeight: 700, color }}>
          {initials(r.name)}
        </span>
      )}
      {badge}
      <AnimatePresence>
        {isHover && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.14 }}
            style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: "50%", x: "-50%",
              whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
              background: "var(--card)", color: "var(--w)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 10,
            }}
          >
            {r.name}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// Count pill that springs when its number changes (real-time arrivals).
function Count({ n, bg, fg }: { n: number; bg: string; fg: string }) {
  const { reduce } = useMapCtx();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={n}
        initial={reduce ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { scale: 0.3, opacity: 0 }}
        transition={trans(reduce)}
        style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: bg, color: fg, lineHeight: 1.4, display: "inline-block" }}
      >
        {n}
      </motion.span>
    </AnimatePresence>
  );
}

// A wrapped row of avatars with enter/exit + reflow animation.
function Cluster({ children }: { children: ReactNode }) {
  return (
    <motion.div layout="position" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <AnimatePresence mode="popLayout">{children}</AnimatePresence>
    </motion.div>
  );
}

// ── DRAG & DROP (B2 track) ───────────────────────────────────────────────────
// A Dot made draggable via @dnd-kit. Disabled → plain Dot when the viewer can't
// move stages. Uses DragOverlay (see B2 branch) so NO transform is applied to
// the source — Motion keeps full control of layout/hover; the source just dims.
function DraggableDot({ r, ringColor, halo, index }: { r: MapRow; ringColor?: string; halo?: string; index?: number }) {
  const { canDragB2 } = useMapCtx();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: r.userId, disabled: !canDragB2 });
  return (
    <Dot
      r={r} index={index} ringColor={ringColor} halo={halo}
      dragRef={setNodeRef}
      dragHandle={canDragB2 ? { ...listeners, ...attributes } : undefined}
      isDragging={isDragging}
      draggable={canDragB2}
    />
  );
}

// A floating copy of the avatar that follows the cursor while dragging.
function OverlayAvatar({ r }: { r: MapRow }) {
  const color = b2StageColor(normalizeB2Stage(r.b2Stage));
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 999, border: `2px solid ${color}`, background: "var(--bg2)",
      overflow: "hidden", boxShadow: "0 10px 24px rgba(0,0,0,0.5)", transform: "rotate(-5deg)", cursor: "grabbing",
    }}>
      {r.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: 12, fontWeight: 700, color }}>
          {initials(r.name)}
        </span>
      )}
    </div>
  );
}

// One B2 stage = a droppable row. Drop a face here → move them to this stage.
function DroppableStageRow({ stage, here, isLast }: { stage: B2StageDef; here: MapRow[]; isLast: boolean }) {
  const { lang, canDragB2 } = useMapCtx();
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const label = stage.label[(lang as "en" | "fr" | "de")] ?? stage.label.en;
  const lit = here.length > 0 || isOver;
  return (
    <div ref={setNodeRef} style={{
      display: "flex", gap: 12, alignItems: "flex-start", padding: 4, borderRadius: 12,
      transition: "background .15s, box-shadow .15s",
      background: isOver ? `color-mix(in srgb, ${stage.color} 12%, transparent)` : "transparent",
      boxShadow: isOver ? `inset 0 0 0 1.5px ${stage.color}` : "none",
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch", width: 22, flexShrink: 0 }}>
        <span style={{ width: 13, height: 13, borderRadius: 999, marginTop: 4, background: lit ? stage.color : "var(--bg2)", border: `2px solid ${lit ? stage.color : "var(--border)"}` }} />
        {!isLast && <span style={{ flex: 1, width: 2, minHeight: 28, background: "var(--border)" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: here.length ? 8 : 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: lit ? "var(--w)" : "var(--w3)" }}>{label}</span>
          {here.length > 0 && <Count n={here.length} bg={`color-mix(in srgb, ${stage.color} 18%, transparent)`} fg={stage.color} />}
        </div>
        {here.length > 0 ? (
          <Cluster>
            {here.map((r, idx) => <DraggableDot key={r.userId} r={r} index={idx} ringColor={stage.color} halo={r.b2Failed ? B2_FAILED_COLOR : undefined} />)}
          </Cluster>
        ) : isOver && canDragB2 ? (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: stage.color }}>⤵ {lang === "de" ? "hier ablegen" : lang === "fr" ? "déposer ici" : "drop here"}</span>
        ) : null}
      </div>
    </div>
  );
}

export function JourneyMap({
  rows, lang, onPick, track = "journey", onMoveB2,
}: {
  rows: MapRow[];
  lang: string;
  onPick: (userId: string) => void;
  /** Which roadmap to show: the main Morocco→Germany journey, or the B2 track. */
  track?: MapTrack;
  /** B2 track: drop a face on a stage → move them there. Omit to disable drag. */
  onMoveB2?: (userId: string, toStage: B2Stage) => void;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [hover, setHover] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<string | null>(null);
  const reduce = !!useReducedMotion();
  // Click still opens the candidate; a 6px move starts a drag (so taps ≠ drags).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const canDragB2 = !!onMoveB2;
  const ctx: MapCtxVal = { track, lang, hover, setHover, onPick, reduce, canDragB2 };

  // Drop a face onto a B2 stage row → move them there (no-op if same stage).
  const onB2DragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const overId = e.over?.id;
    const uid = String(e.active.id);
    if (!overId) return;
    const toStage = String(overId) as B2Stage;
    const row = rows.find((x) => x.userId === uid);
    if (!row) return;
    if (normalizeB2Stage(row.b2Stage) === toStage) return;
    onMoveB2?.(uid, toStage);
  };

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

  // B2 certificate track: group candidates by their B2 stage (one linear rail).
  const b2 = useMemo(() => {
    const by = new Map<B2Stage, MapRow[]>();
    for (const r of rows) {
      const st = normalizeB2Stage(r.b2Stage);
      (by.get(st) ?? by.set(st, []).get(st)!).push(r);
    }
    return { by };
  }, [rows]);

  const doneRows = byStation.get("__done__") ?? [];

  // ── B2 TRACK — ONE linear rail. Each candidate's RING colour = their B2 stage
  // (grey→blue→yellow→amber→green). A persistent RED HALO = failed B2 at least
  // once: such a candidate keeps the red halo forever while they move back
  // through the stages for a retake, so you always spot the re-takers. ─────────
  if (track === "b2") {
    const failedCount = rows.filter((r) => r.b2Failed).length;
    return (
      <MapCtx.Provider value={ctx}>
        <div className="bv-card" style={{ padding: "18px 16px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--w)" }}>📜 {T("B2 German — certificate pathway", "B2 Deutsch — Zertifikatsweg", "B2 allemand — parcours de certification")}</span>
          </div>
          {/* Legend: stage colours + the red-halo = failed-before meaning. */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, fontSize: 11, color: "var(--w3)" }}>
            {B2_STAGES.map((s) => (
              <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: s.color }} />
                {s.label[(lang as "en" | "fr" | "de")] ?? s.label.en}
              </span>
            ))}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: "var(--bg2)", boxShadow: `0 0 0 2px ${B2_FAILED_COLOR}` }} />
              {T("failed before (retaking)", "vorher nicht bestanden", "échoué avant")}{failedCount > 0 ? ` · ${failedCount}` : ""}
            </span>
          </div>
          {/* Drag hint — only when the viewer can actually move stages. */}
          {canDragB2 && (
            <p style={{ fontSize: 11, color: "var(--w3)", marginTop: -8, marginBottom: 14 }}>
              {T("Tip: drag a face onto another stage to move them — e.g. didn't pass → drag back to a new exam date.",
                 "Tipp: Ziehe ein Gesicht auf eine andere Stufe, um es zu verschieben — z. B. nicht bestanden → zurück zu einem neuen Termin.",
                 "Astuce : faites glisser un visage sur une autre étape pour le déplacer — ex. échoué → vers une nouvelle date d'examen.")}
            </p>
          )}
          {/* Single vertical rail of the 5 stages — each row is a DROP TARGET.
              Drag a face onto a stage to move them; Motion glides them home. */}
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={(e) => setActiveDrag(String(e.active.id))} onDragEnd={onB2DragEnd} onDragCancel={() => setActiveDrag(null)}>
            <LayoutGroup>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {B2_STAGES.map((s, i) => (
                  <DroppableStageRow key={s.key} stage={s} here={b2.by.get(s.key) ?? []} isLast={i === B2_STAGES.length - 1} />
                ))}
              </div>
            </LayoutGroup>
            {/* Floating avatar that follows the cursor; no drop-snap so Motion's
                layout glide places the real face in its new row. */}
            <DragOverlay dropAnimation={null}>
              {activeDrag ? (() => {
                const r = rows.find((x) => x.userId === activeDrag);
                return r ? <OverlayAvatar r={r} /> : null;
              })() : null}
            </DragOverlay>
          </DndContext>
          {rows.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "1rem 0" }}>{T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}</p>
          )}
        </div>
      </MapCtx.Provider>
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
      <MapCtx.Provider value={ctx}>
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
            <LayoutGroup>
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
                      {notStartedImpf.length > 0 && <Count n={notStartedImpf.length} bg="var(--gdim)" fg="var(--gold)" />}
                    </div>
                    {notStartedImpf.length > 0 && (
                      <Cluster>{notStartedImpf.map((r, idx) => <Dot key={r.userId} r={r} index={idx} />)}</Cluster>
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
                          {here.length > 0 && <Count n={here.length} bg={`color-mix(in srgb, ${s.color} 18%, transparent)`} fg={s.color} />}
                        </div>
                        {here.length > 0 && (
                          <Cluster>
                            {here.map((r, idx) => (
                              <Dot key={r.userId} r={r} index={idx} badge={
                                (s.key === "in_progress" || s.key === "appointment") && r.impfungDoses && r.impfungDoses.need > 0 ? (
                                  <span style={{ position: "absolute", bottom: -4, right: -4, fontSize: 8, fontWeight: 800, lineHeight: 1, padding: "1px 3px", borderRadius: 5, background: s.color, color: "#fff", border: "1.5px solid var(--card)" }}>
                                    {r.impfungDoses.got}/{r.impfungDoses.need}
                                  </span>
                                ) : undefined
                              } />
                            ))}
                          </Cluster>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </LayoutGroup>
          )}
        </div>
      </MapCtx.Provider>
    );
  }

  return (
    <MapCtx.Provider value={ctx}>
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
        <LayoutGroup>
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
                      {startHere.length > 0 && <Count n={startHere.length} bg="var(--gdim)" fg="var(--gold)" />}
                    </div>
                    {startHere.length > 0 && (
                      <Cluster>{startHere.map((r, idx) => <Dot key={r.userId} r={r} index={idx} />)}</Cluster>
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
                      {here.length > 0 && <Count n={here.length} bg="var(--gdim)" fg="var(--gold)" />}
                    </div>
                    {here.length > 0 && (
                      <Cluster>{here.map((r, idx) => <Dot key={r.userId} r={r} index={idx} />)}</Cluster>
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
                  {doneRows.length > 0 && <Count n={doneRows.length} bg="rgba(22,163,74,0.15)" fg="#16a34a" />}
                </div>
                {doneRows.length > 0 && (
                  <Cluster>{doneRows.map((r, idx) => <Dot key={r.userId} r={r} index={idx} />)}</Cluster>
                )}
              </div>
            </div>
          </div>
        </LayoutGroup>

        {rows.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "1rem 0" }}>
            {T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}
          </p>
        )}
      </div>
    </MapCtx.Provider>
  );
}
