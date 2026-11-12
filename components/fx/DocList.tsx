"use client";
/**
 * Her papers in ONE list (founder 2026-11-12, sample "2"): the three special boxes (Reisepass, Lebenslauf,
 * Motivationsschreiben) on top in the normal text font; below, one list of every paper, most important first,
 * the whole row coloured by its state (green done · orange waiting · red redo · dashed = missing). A pair
 * (original + translation) or the Deutsch paper slides its sheets down on a tap. Filter Alle · Anerkennung ·
 * Visum stays (the parent saves it). Agency / employer / per-nurse extras close the list; admins add (+) and
 * remove (×, only while empty) per-nurse extras. Phone: 7 rows per page, ‹ ›. Nobody scrolls.
 */
import React from "react";
import { supabase } from "@/lib/supabase";

export type ExtraPaper = { id: string; label: string; phase: "A" | "V" };

/** Her extra papers + the filter that stays (app/api/portal/doclist). userId = the nurse (admins); none = herself. */
export function useDocMeta(userId?: string | null, on = true) {
  const [extras, setExtras] = React.useState<ExtraPaper[]>([]);
  const [mode, setModeState] = React.useState<DocMode>("all");
  const call = React.useCallback(async (method: string, body?: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) return null;
    const q = method === "GET" && userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const r = await fetch(`/api/portal/doclist${q}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...(userId ? { userId } : {}), ...body }) : undefined,
    }).catch(() => null);
    return r;
  }, [userId]);
  const load = React.useCallback(async () => {
    const r = await call("GET");
    const j = r?.ok ? ((await r.json().catch(() => null)) as { extras?: ExtraPaper[]; view?: DocMode } | null) : null;
    if (j) { setExtras(j.extras ?? []); setModeState(j.view ?? "all"); }
  }, [call]);
  React.useEffect(() => { setExtras([]); setModeState("all"); if (on) void load(); }, [load, on]);
  const setMode = React.useCallback((m: DocMode) => { setModeState(m); void call("PUT", { view: m }); }, [call]);
  const add = React.useCallback(async (label: string, phase: "A" | "V") => {
    const r = await call("POST", { label, phase });
    if (r?.ok) await load();
  }, [call, load]);
  /** false = it already holds a file (it stays) */
  const remove = React.useCallback(async (id: string) => {
    const r = await call("DELETE", { id });
    if (r?.ok) await load();
    return !!r?.ok;
  }, [call, load]);
  return { extras, mode, setMode, add, remove, reload: load };
}

export type DocSt = "approved" | "pending" | "rejected" | "missing";
export type DocSub = { label: string; st: DocSt; act: () => void; de?: boolean };
export type DocRow = {
  id: string; label: string; st: DocSt; tags: string; act: () => void;
  sub?: DocSub[]; special?: boolean; onInfo?: () => void; extra?: boolean; onRemove?: () => void;
};
export type DocKey = { id: "id" | "cv" | "letter"; label: string; st: DocSt; act: () => void; spark?: boolean };
export type DocMode = "all" | "A" | "V";

const DOT: Record<DocSt, string> = { approved: "#16a34a", pending: "#f59e0b", rejected: "#dc2626", missing: "#d8d0c0" };
const TINT: Record<DocSt, string> = { approved: "rgba(22,163,74,.10)", pending: "rgba(245,158,11,.16)", rejected: "rgba(220,38,38,.12)", missing: "transparent" };
const worst = (a: DocSt[]): DocSt => (a.includes("rejected") ? "rejected" : a.includes("pending") ? "pending" : a.includes("missing") ? "missing" : "approved");
export const rowSt = (r: DocRow): DocSt => (r.sub && !r.special ? worst(r.sub.map((y) => y.st)) : r.st);

const KEY_ICON: Record<DocKey["id"], string> = {
  id: "M7 2.5h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.5 17h7",
  cv: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4",
  letter: "M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z",
};
const SPARK = "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z";

const T = (lang: string, de: string, fr: string, en: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

function useNarrow() {
  const [n, setN] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(max-width:640px)");
    const f = () => setN(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

export function DocList({
  lang, keys, rows, mode, onMode, onAdd, onClose, onLegacy, legacyOpen,
}: {
  lang: string;
  keys: DocKey[];
  rows: DocRow[];
  mode: DocMode;
  onMode: (m: DocMode) => void;
  /** admins: add an extra paper for this nurse */
  onAdd?: (label: string, phase: "A" | "V") => Promise<void> | void;
  onClose?: () => void;
  onLegacy?: () => void;
  legacyOpen?: boolean;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newPhase, setNewPhase] = React.useState<"A" | "V">("A");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setPage(0); setOpen(null); }, [mode]);

  const shown = rows.filter((r) => mode === "all" || r.tags.includes(mode));
  const PER = narrow ? 7 : 30;
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const pg = Math.min(page, pages - 1);
  const slice = shown.slice(pg * PER, pg * PER + PER);
  const lastPage = pg === pages - 1;

  const submitAdd = async () => {
    if (!onAdd || newLabel.trim().length < 2 || busy) return;
    setBusy(true);
    try { await onAdd(newLabel.trim(), newPhase); setAdding(false); setNewLabel(""); } finally { setBusy(false); }
  };

  const row = (x: DocRow) => {
    const st = rowSt(x);
    const isOpen = open === x.id;
    return (
      <div key={x.id} className="relative" style={{ breakInside: "avoid", marginBottom: 6, zIndex: isOpen ? 31 : undefined }}>
        <div className="flex items-center" style={{ gap: 10, padding: "0 6px 0 0", borderRadius: 10, background: TINT[st],
          border: isOpen ? "1px solid var(--w)" : st === "missing" ? "1px dashed #d8d0c0" : "1px solid transparent" }}>
          <button type="button" onClick={x.sub ? () => setOpen(isOpen ? null : x.id) : x.act} aria-expanded={x.sub ? isOpen : undefined} title={x.label}
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: 0, padding: "10px 0 10px 12px", fontSize: 13.5, color: "var(--w)",
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: x.special ? 600 : 400 }}>
            {x.label}
          </button>
          {x.onInfo && (
            <button type="button" onClick={x.onInfo} aria-label={T(lang, "So bekommst du sie", "Comment l’obtenir", "How to get it")}
              style={{ width: 18, height: 18, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", fontSize: 10,
                fontStyle: "italic", fontFamily: "Georgia, serif", display: "grid", placeItems: "center", cursor: "pointer", padding: 0, flex: "none" }}>i</button>
          )}
          {x.onRemove && (
            <button type="button" onClick={x.onRemove} aria-label={T(lang, "Entfernen", "Retirer", "Remove")}
              style={{ background: "none", border: 0, color: "var(--w3)", fontSize: 15, lineHeight: 1, cursor: "pointer", padding: "4px 4px", flex: "none" }}>×</button>
          )}
        </div>
        {x.sub && isOpen && (<>
          <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setOpen(null)} />
          <div className="absolute left-0 right-0 flex justify-center bv-dl-slide" style={{ top: "calc(100% + 6px)", zIndex: 32, gap: 8, padding: 10, borderRadius: 14,
            background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 18px 40px -18px rgba(21,19,15,.35)" }}>
            {x.sub.map((y) => (
              <button key={y.label} type="button" onClick={() => { setOpen(null); y.act(); }} title={`${x.label} · ${y.label}`}
                className="flex flex-col items-center" style={{ flex: 1, minWidth: 0, gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--w2)", fontFamily: "inherit" }}>
                <span className="relative grid place-items-center" style={{ width: 44, height: 56, borderRadius: 6,
                  ...(y.st === "missing" ? { border: "1.5px dashed #d8d0c0", color: "var(--gold)" } : { background: TINT[y.st] === "transparent" ? "var(--bg2)" : TINT[y.st], border: "1px solid var(--border)", color: "var(--w3)" }) }}>
                  {y.st === "missing"
                    ? <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                    : y.de ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "var(--w2)" }}>DE</span>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>}
                  <i className="absolute" style={{ right: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: DOT[y.st], border: "2px solid var(--card)" }} />
                </span>
                <span style={{ fontSize: 10.5, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{y.label}</span>
              </button>
            ))}
          </div>
        </>)}
      </div>
    );
  };

  return (
    <section className="mt-6" style={{ scrollMarginTop: 80 }}>
      <style>{"@keyframes bvDlSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:no-preference){.bv-dl-slide{animation:bvDlSlide .18s ease-out}}"
        + "@media (max-width:640px){.bv-dl-hdr{flex-wrap:wrap}.bv-dl-switch{order:3;margin-left:0!important;width:100%;justify-content:space-between}.bv-dl-switch>button{flex:1;padding:6px 4px!important}"
        + ".bv-dl-key{flex-direction:column;text-align:center;padding:14px 6px!important;gap:8px!important}.bv-dl-key-name{font-size:12.5px!important}.bv-dl-key-spark{position:absolute;left:10px;top:10px}}"}</style>
      <div className="bv-dl-hdr flex items-center" style={{ gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 30, color: "var(--w)" }}>{T(lang, "Unterlagen", "Documents", "Documents")}</h2>
        <span className="bv-dl-switch inline-flex" role="tablist" style={{ marginLeft: "auto", gap: 2, padding: 3, borderRadius: 999, background: "var(--bg2)" }}>
          {([["all", T(lang, "Alle", "Tous", "All")], ["A", T(lang, "Anerkennung", "Reconnaissance", "Recognition")], ["V", T(lang, "Visum", "Visa", "Visa")]] as [DocMode, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => onMode(k)}
              style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 500, border: 0, cursor: "pointer", fontFamily: "inherit",
                background: mode === k ? "var(--card)" : "transparent", color: mode === k ? "var(--w)" : "var(--w3)", boxShadow: mode === k ? "0 2px 8px -4px rgba(21,19,15,.3)" : "none" }}>{l}</button>
          ))}
        </span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={T(lang, "Schließen", "Fermer", "Close")}
            style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer" }}>✕</button>
        )}
      </div>

      {/* the three special boxes — whole box = the action (passport / the builders) */}
      <div className="grid mb-4" style={{ gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {keys.map((k) => (
          <button key={k.id} type="button" onClick={k.act} className="relative flex items-center text-left bv-dl-key"
            style={{ gap: 12, padding: "14px 16px", borderRadius: 14, background: "var(--card)", border: `1px solid ${k.st === "pending" ? "#fcd9a8" : "var(--border)"}`, minWidth: 0, cursor: "pointer", color: "var(--w)", fontFamily: "inherit" }}>
            <span className="absolute" style={{ right: 10, top: 10, width: 9, height: 9, borderRadius: "50%", background: DOT[k.st] }} />
            <span className="grid place-items-center flex-none" style={{ width: 38, height: 38, borderRadius: 10, background: "var(--bg2)", color: "var(--gold)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={KEY_ICON[k.id]} /></svg>
            </span>
            <span className="bv-dl-key-name" lang="de" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, hyphens: "manual" }}>{k.label.replace(/^(Motivations)(?=schreiben)/, "$1­")}</span>
            {k.spark && <span className="bv-dl-key-spark flex-none" style={{ color: "var(--gold)", display: "inline-flex" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SPARK} /></svg></span>}
          </button>
        ))}
      </div>

      <div style={{ columnCount: narrow ? 1 : 3, columnGap: 18 }}>
        {slice.map(row)}
        {onAdd && lastPage && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center w-full"
            style={{ breakInside: "avoid", gap: 10, padding: "10px 12px", background: "none", border: 0, color: "var(--gold)", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>{T(lang, "Unterlage hinzufügen", "Ajouter un document", "Add a paper")}
          </button>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center mt-3" style={{ gap: 10 }}>
          <button type="button" onClick={() => setPage(Math.max(0, pg - 1))} disabled={pg === 0} aria-label="‹"
            style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: pg === 0 ? "var(--border)" : "var(--w2)", cursor: pg === 0 ? "default" : "pointer" }}>‹</button>
          <span style={{ fontSize: 12, color: "var(--w3)" }}>{pg + 1} / {pages}</span>
          <button type="button" onClick={() => setPage(Math.min(pages - 1, pg + 1))} disabled={lastPage} aria-label="›"
            style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: lastPage ? "var(--border)" : "var(--w2)", cursor: lastPage ? "default" : "pointer" }}>›</button>
        </div>
      )}

      {onLegacy && (
        <div className="text-right mt-2">
          <button type="button" onClick={onLegacy} style={{ background: "none", border: 0, padding: 0, fontSize: 12.5, color: "var(--w3)", cursor: "pointer" }}>
            {legacyOpen ? T(lang, "Alte Ansicht schließen", "Fermer l’ancienne vue", "Close the old view") : T(lang, "Alte Ansicht", "Ancienne vue", "Old view")}
          </button>
        </div>
      )}

      {/* add an extra paper for this nurse — the universal popup (LAW #36: z 1100, blur 8, radius 20) */}
      {adding && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 1100, background: "rgba(0,0,0,.35)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", padding: 16 }}
          onClick={() => !busy && setAdding(false)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 380, borderRadius: 20, background: "var(--card)", border: "1px solid var(--border)", padding: 22, boxShadow: "0 26px 60px -24px rgba(0,0,0,.42)" }}>
            <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, color: "var(--w)" }}>{T(lang, "Unterlage hinzufügen", "Ajouter un document", "Add a paper")}</h3>
            <input autoFocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitAdd(); }}
              maxLength={80} placeholder={T(lang, "Name", "Nom", "Name")}
              style={{ width: "100%", height: 44, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: "0 12px", fontSize: 14, color: "var(--w)", outline: "none" }} />
            <div className="flex" style={{ gap: 6, marginTop: 10 }}>
              {(["A", "V"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setNewPhase(p)} aria-pressed={newPhase === p}
                  style={{ flex: 1, height: 36, borderRadius: 999, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${newPhase === p ? "var(--w)" : "var(--border)"}`, background: newPhase === p ? "var(--w)" : "var(--card)", color: newPhase === p ? "var(--bg)" : "var(--w2)" }}>
                  {p === "A" ? T(lang, "Anerkennung", "Reconnaissance", "Recognition") : T(lang, "Visum", "Visa", "Visa")}
                </button>
              ))}
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setAdding(false)} disabled={busy}
                style={{ flex: 1, height: 44, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w2)", fontSize: 14, cursor: "pointer" }}>{T(lang, "Abbrechen", "Annuler", "Cancel")}</button>
              <button type="button" onClick={() => void submitAdd()} disabled={busy || newLabel.trim().length < 2}
                style={{ flex: 1, height: 44, borderRadius: 10, border: 0, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: busy || newLabel.trim().length < 2 ? 0.5 : 1 }}>{T(lang, "Hinzufügen", "Ajouter", "Add")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
