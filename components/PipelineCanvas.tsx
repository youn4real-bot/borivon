"use client";

/**
 * Pipeline CANVAS — the Figma/Miro-style infinite board.
 *
 * Same candidate data as JourneyMap, but on a zoomable + pannable React Flow
 * canvas: scroll to zoom big, drag the empty space to pan, drag a face between
 * stage lanes (B2 track) to move them. Minimap + zoom controls + dotted grid.
 *
 * Stages are big horizontal LANES stacked top→bottom; each candidate is a large
 * avatar node sitting in their stage's lane. Click a face → peek popup (onPick).
 * On the B2 track, dropping a face in another lane persists via onMoveB2.
 */

import { useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  useNodesState, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { B2_STAGES, B2_FAILED_COLOR, b2StageColor, normalizeB2Stage } from "@/lib/b2Journey";
import { IMPFUNG_STAGES, IMPFUNG_STAGE_BY_KEY } from "@/lib/impfungJourney";
import type { MapRow, MapTrack } from "@/components/JourneyMap";

const HEALTH_COLOR: Record<string, string> = {
  blocked: "#ef4444", overdue: "#f97316", due_soon: "#f59e0b", on_track: "#16a34a", done: "#6b7280",
};

// Canvas geometry — big on purpose (the user zooms to taste).
const AV = 60;
const LANE_H = 156;
const LANE_GAP = 36;
const PAD_X = 36;
const GAP_X = 20;
const MIN_LANE_W = 620;

function initials(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

type Lane = { key: string; label: string; color: string };
type AvatarData = { row: MapRow; color: string; halo?: string };
type ZoneData = { label: string; color: string; count: number; w: number; h: number };

// ── Custom nodes (module-level → stable identity for React Flow) ──────────────
function ZoneNode({ data }: NodeProps) {
  const d = data as unknown as ZoneData;
  return (
    <div style={{
      width: d.w, height: d.h, borderRadius: 22,
      background: "color-mix(in srgb, var(--card) 92%, transparent)",
      border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 18px" }}>
        <span style={{ width: 13, height: 13, borderRadius: 999, background: d.color, boxShadow: `0 0 0 5px color-mix(in srgb, ${d.color} 20%, transparent)` }} />
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--w)", letterSpacing: -0.3 }}>{d.label}</span>
        {d.count > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: `color-mix(in srgb, ${d.color} 18%, transparent)`, color: d.color }}>{d.count}</span>
        )}
      </div>
    </div>
  );
}

function AvatarNode({ data }: NodeProps) {
  const d = data as unknown as AvatarData;
  const r = d.row;
  const halo = d.halo ? `0 0 0 4px ${d.halo}` : "";
  return (
    <div
      title={d.halo ? `${r.name} — failed B2 before (retaking)` : r.name}
      style={{
        width: AV, height: AV, borderRadius: 999, overflow: "visible",
        border: `3px solid ${d.color}`, background: "var(--bg2)",
        boxShadow: [halo, "0 4px 12px rgba(0,0,0,0.35)"].filter(Boolean).join(", "),
      }}>
      {r.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photo} alt="" style={{ width: "100%", height: "100%", borderRadius: 999, objectFit: "cover", pointerEvents: "none" }} />
      ) : (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: 20, fontWeight: 700, color: d.color }}>
          {initials(r.name)}
        </span>
      )}
    </div>
  );
}

const NODE_TYPES = { zone: ZoneNode, avatar: AvatarNode };

// ── Lane sets + grouping per track ────────────────────────────────────────────
function lanesFor(track: MapTrack, lang: string): Lane[] {
  const L = (o: { en: string; fr: string; de: string }) => o[(lang as "en" | "fr" | "de")] ?? o.en;
  if (track === "b2") {
    return B2_STAGES.map((s) => ({ key: s.key, label: L(s.label), color: s.color }));
  }
  if (track === "impfung") {
    return [
      { key: "not_started", label: L({ en: "Required — not started", fr: "Requis — pas commencé", de: "Erforderlich — nicht begonnen" }), color: "#6b7280" },
      ...IMPFUNG_STAGES.map((s) => ({ key: s.key, label: L(s.label), color: s.color })),
    ];
  }
  // journey
  const presets = JOURNEY_PRESETS.slice().sort((a, b) => a.position - b.position);
  return [
    { key: "__start__", label: `🇲🇦 ${L({ en: "Just started", fr: "Vient de commencer", de: "Gerade begonnen" })}`, color: "#c9a14a" },
    ...presets.map((p) => ({ key: p.key, label: L(p.label), color: "#c9a14a" })),
    { key: "__done__", label: `🇩🇪 ${L({ en: "Arrived in Germany", fr: "Arrivé en Allemagne", de: "In Deutschland angekommen" })}`, color: "#16a34a" },
  ];
}

function laneKeyForRow(track: MapTrack, r: MapRow): string | null {
  if (track === "b2") return normalizeB2Stage(r.b2Stage);
  if (track === "impfung") {
    const st = r.impfungStage ?? "not_required";
    return st === "not_required" ? null : st; // not_required → off the board
  }
  return r.status.health === "done" ? "__done__" : (r.status.reached?.key ?? "__start__");
}

function ringColorForRow(track: MapTrack, r: MapRow): { color: string; halo?: string } {
  if (track === "b2") {
    return { color: b2StageColor(normalizeB2Stage(r.b2Stage)), halo: r.b2Failed ? B2_FAILED_COLOR : undefined };
  }
  if (track === "impfung") {
    const st = r.impfungStage ?? "not_required";
    return { color: IMPFUNG_STAGE_BY_KEY[st]?.color ?? "#6b7280" };
  }
  return { color: HEALTH_COLOR[r.status.health] ?? "#6b7280" };
}

function buildNodes(rows: MapRow[], track: MapTrack, lang: string): { nodes: Node[]; laneCenters: { key: string; cy: number }[] } {
  const lanes = lanesFor(track, lang);
  // Group rows per lane.
  const byLane = new Map<string, MapRow[]>();
  for (const r of rows) {
    const k = laneKeyForRow(track, r);
    if (!k) continue;
    (byLane.get(k) ?? byLane.set(k, []).get(k)!).push(r);
  }
  const maxCount = Math.max(1, ...lanes.map((l) => (byLane.get(l.key)?.length ?? 0)));
  const laneW = Math.max(MIN_LANE_W, PAD_X * 2 + maxCount * (AV + GAP_X));

  const nodes: Node[] = [];
  const laneCenters: { key: string; cy: number }[] = [];
  lanes.forEach((lane, i) => {
    const top = i * (LANE_H + LANE_GAP);
    const here = byLane.get(lane.key) ?? [];
    laneCenters.push({ key: lane.key, cy: top + LANE_H / 2 });
    nodes.push({
      id: `zone:${lane.key}`, type: "zone", position: { x: 0, y: top },
      data: { label: lane.label, color: lane.color, count: here.length, w: laneW, h: LANE_H } as unknown as ZoneData,
      draggable: false, selectable: false, connectable: false, zIndex: 0,
      style: { width: laneW, height: LANE_H },
    });
    const avY = top + 70;
    here.forEach((r, idx) => {
      const ring = ringColorForRow(track, r);
      nodes.push({
        id: r.userId, type: "avatar", position: { x: PAD_X + idx * (AV + GAP_X), y: avY },
        data: { row: r, color: ring.color, halo: ring.halo } as unknown as AvatarData,
        draggable: track === "b2", selectable: false, connectable: false, zIndex: 10,
      });
    });
  });
  return { nodes, laneCenters };
}

export function PipelineCanvas({
  rows, track, lang, onPick, onMoveB2,
}: {
  rows: MapRow[];
  track: MapTrack;
  lang: string;
  onPick: (userId: string) => void;
  onMoveB2?: (userId: string, toStage: string) => void;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const built = useMemo(() => buildNodes(rows, track, lang), [rows, track, lang]);
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);

  // Re-layout whenever the data / track changes (e.g. after a drag persists).
  useEffect(() => { setNodes(built.nodes); }, [built.nodes, setNodes]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === "avatar") onPick(node.id);
  }, [onPick]);

  // Drop a face in another lane → move them to that stage (B2 only).
  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent, node: Node) => {
    if (track !== "b2" || node.type !== "avatar" || !onMoveB2) return;
    const cy = node.position.y + AV / 2;
    let best = built.laneCenters[0]; let bestD = Infinity;
    for (const lc of built.laneCenters) { const d = Math.abs(lc.cy - cy); if (d < bestD) { bestD = d; best = lc; } }
    const row = rows.find((r) => r.userId === node.id);
    if (!row || !best) return;
    if (normalizeB2Stage(row.b2Stage) === best.key) { setNodes(built.nodes); return; } // snap back
    onMoveB2(node.id, best.key);
  }, [track, onMoveB2, built, rows, setNodes]);

  const empty = nodes.every((n) => n.type === "zone");

  return (
    <div className="bv-card" style={{ padding: 0, overflow: "hidden", borderRadius: "var(--r-lg)" }}>
      {/* Hint bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--w)" }}>
          {track === "b2" ? "📜" : track === "impfung" ? "💉" : "🗺️"} {T("Canvas", "Leinwand", "Canevas")}
        </span>
        <span style={{ fontSize: 11, color: "var(--w3)" }}>
          {T("Scroll to zoom · drag the space to pan · click a face for details",
             "Scrollen zum Zoomen · Fläche ziehen zum Verschieben · Gesicht anklicken für Details",
             "Molette pour zoomer · glisser le fond pour déplacer · cliquer un visage pour les détails")}
          {track === "b2" ? ` · ${T("drag a face to another stage to move them", "Gesicht in eine andere Stufe ziehen zum Verschieben", "glisser un visage vers une autre étape pour le déplacer")}` : ""}
        </span>
      </div>
      <div style={{ height: "min(76vh, 760px)", width: "100%", position: "relative" }}>
        <ReactFlow
          key={track}
          nodes={nodes}
          onNodesChange={onNodesChange}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.1}
          maxZoom={3}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: "var(--bg2)" }}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="var(--border)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2}
            nodeColor={(n) => (n.type === "zone" ? "transparent" : ((n.data as unknown as AvatarData)?.color ?? "#6b7280"))}
            maskColor="rgba(0,0,0,0.55)" style={{ background: "var(--card)" }} />
        </ReactFlow>
        {empty && (
          <p style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--w3)", fontSize: 13, pointerEvents: "none" }}>
            {T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}
          </p>
        )}
      </div>
    </div>
  );
}
