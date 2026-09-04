"use client";

/**
 * "Add people" to the open batch (supreme admin only). A minimalist picker:
 * search box + the candidates NOT already in this batch; tap one to add it
 * (stays open so you can add several). Reuses the page's already-loaded people
 * (no extra fetch) and the shared onAssign (PATCH /api/portal/batches).
 */

import { useMemo, useState } from "react";
import { Search, Plus, Check, X as XIcon } from "lucide-react";

export type PickCandidate = { uid: string; name: string; email: string; photo: string | null; currentBatchId: string | null };

export function BatchAddPeople({
  batchId,
  batchName,
  candidates,
  lang,
  onAssign,
  onClose,
}: {
  batchId: string;
  batchName: string;
  candidates: PickCandidate[];
  lang: string;
  onAssign: (uid: string, batchId: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates
      .filter((c) => c.currentBatchId !== batchId) // only those not already in this batch
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [candidates, q, batchId]);

  const add = async (uid: string) => {
    if (added.has(uid)) return;
    setAdded((prev) => new Set(prev).add(uid));
    const ok = await onAssign(uid, batchId);
    // On failure, undo the optimistic "added" so the row re-enables + the count
    // stays truthful (no false success).
    if (!ok) setAdded((prev) => { const n = new Set(prev); n.delete(uid); return n; });
  };

  const inp: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: 10, height: 40, fontSize: 14, paddingLeft: 34, paddingRight: 12, width: "100%" };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full flex flex-col p-4" style={{ maxWidth: 440, maxHeight: "82vh", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate" style={{ color: "var(--w)" }}>{L("Add people", "Ajouter des personnes", "Personen hinzufügen")}</div>
            <div className="text-[11.5px] truncate" style={{ color: "var(--w3)" }}>{batchName.replace(/_/g, " ")}</div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto opacity-70 hover:opacity-100" style={{ color: "var(--w2)" }}><XIcon size={18} strokeWidth={2} /></button>
        </div>

        <div className="relative flex items-center mb-2">
          <Search size={15} strokeWidth={1.8} className="absolute left-3 pointer-events-none" style={{ color: "var(--w3)" }} />
          <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search a name or email", "Chercher un nom ou e-mail", "Name oder E-Mail suchen")} style={inp} />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1" style={{ minHeight: 120 }}>
          {list.length === 0 ? (
            <p className="text-[12.5px] text-center py-8" style={{ color: "var(--w3)" }}>
              {q ? L("No matches.", "Aucun résultat.", "Keine Treffer.") : L("Everyone is already in this batch.", "Tout le monde est déjà dans ce lot.", "Alle sind bereits in diesem Batch.")}
            </p>
          ) : list.map((c) => {
            const done = added.has(c.uid);
            return (
              <button key={c.uid} type="button" onClick={() => add(c.uid)} disabled={done}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors bv-row-hover disabled:opacity-60">
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo} alt={c.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" style={{ border: "1px solid var(--border-gold)" }} />
                ) : (
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0" style={{ background: "var(--gdim)", color: "var(--gold)" }}>{c.name.charAt(0).toUpperCase()}</span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{c.name}</span>
                  <span className="block text-[11px] truncate" style={{ color: "var(--w3)" }}>{c.email}</span>
                </span>
                {done ? (
                  <Check size={16} strokeWidth={2.4} className="flex-shrink-0" style={{ color: "#16a34a" }} />
                ) : (
                  <Plus size={16} strokeWidth={2.2} className="flex-shrink-0" style={{ color: "var(--gold)" }} />
                )}
              </button>
            );
          })}
        </div>

        {added.size > 0 && (
          <p className="text-[11.5px] mt-2 text-center" style={{ color: "var(--w2)" }}>
            {added.size} {L("added", "ajouté(s)", "hinzugefügt")}
          </p>
        )}
      </div>
    </div>
  );
}
