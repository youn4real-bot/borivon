"use client";

/**
 * SMART SEARCH — the "always bring candidates back" bar.
 *
 * The founder types plain language ("candidates who got the B2 certificate in the
 * last year", "who has an interview next week") and gets REAL candidates back,
 * clickable straight into their dossier. The AI only decides the filter server-side
 * (POST /api/portal/admin/search); the people come from the actual database, so a
 * result is always a real, in-scope candidate — never invented.
 *
 * Self-contained on purpose: it owns its own state and renders its own results
 * panel, so it drops into the admin page without touching the existing candidate
 * list / attribute filter. Clicking a result calls onOpen(uid), which opens the
 * same dossier the list cards open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, X as XIcon, SearchX, User } from "lucide-react";

type Hit = {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
  why: string;
  sub: string;
  stageColor: string;
  pendingDocs: number;
};
type SearchResponse = {
  ok: boolean;
  mode?: "list" | "ask";
  // list mode
  usedAI?: boolean;
  empty?: boolean;
  filter?: string[];
  results?: Hit[];
  matched?: number;
  total?: number;
  // ask mode
  answer?: string;
  candidates?: { uid: string; name: string }[];
};

export function AdminSmartSearch({
  accessToken,
  lang,
  onOpen,
}: {
  accessToken: string;
  lang: string;
  onOpen: (uid: string) => void;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  const runSearch = useCallback(
    async (query: string) => {
      const text = query.trim();
      if (!text) { setRes(null); setError(null); return; }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/portal/admin/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ query: text, lang }),
          signal: ac.signal,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setError(j.error || L("Search failed — try again.", "Échec de la recherche — réessayez.", "Suche fehlgeschlagen — erneut versuchen."));
          setRes(null);
          return;
        }
        const data = (await r.json()) as SearchResponse & { error?: string };
        // The route degrades to a 200 with ok:false rather than a 500 — show it.
        if (data.ok === false) {
          setError(data.error || L("Search is temporarily unavailable — try again.", "Recherche momentanément indisponible — réessayez.", "Suche vorübergehend nicht verfügbar — erneut versuchen."));
          setRes(null);
          return;
        }
        setRes(data);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError(L("Search failed — try again.", "Échec de la recherche — réessayez.", "Suche fehlgeschlagen — erneut versuchen."));
      } finally {
        // Only the CURRENT request may clear the spinner — a superseded request's
        // late (abort) rejection must not switch it off while a newer one is in flight.
        if (abortRef.current === ac) setLoading(false);
      }
    },
    [accessToken, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Abort any in-flight fetch on unmount so it can't setState on a dead component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const clearAll = () => {
    abortRef.current?.abort();
    setLoading(false);
    setQ("");
    setRes(null);
    setError(null);
  };

  return (
    <div className="mb-3" role="search">
      {/* ONE plain search field — name / email / phone, or a question. Enter to run.
          Minimalist by request: no card chrome, no example chips, no big button. */}
      <div className="relative flex items-center">
        <Search size={15} strokeWidth={1.8} className="absolute left-3 pointer-events-none" style={{ color: "var(--w3)" }} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void runSearch(q); }
            else if (e.key === "Escape") { e.preventDefault(); clearAll(); }
          }}
          aria-label={L("Search candidates", "Rechercher des candidats", "Kandidaten suchen")}
          placeholder={L(
            "Search a name, email or phone — or ask a question",
            "Cherchez un nom, e-mail ou téléphone — ou posez une question",
            "Name, E-Mail oder Telefon suchen — oder eine Frage stellen",
          )}
          className="w-full outline-none placeholder:opacity-40"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: 10, height: 40, fontSize: 14, paddingLeft: 34, paddingRight: 34 }}
        />
        <span className="absolute right-3 flex items-center" style={{ color: "var(--w3)" }}>
          {loading ? <Loader2 size={15} className="animate-spin" strokeWidth={2} />
            : (q || res) ? (
              <button type="button" onClick={clearAll} aria-label={L("Clear", "Effacer", "Löschen")} className="opacity-60 hover:opacity-100 transition-opacity">
                <XIcon size={15} strokeWidth={2} />
              </button>
            ) : null}
        </span>
      </div>

      {error && (
        <div className="mt-2 text-[12px]" style={{ color: "var(--w2)" }}>{error}</div>
      )}

      {/* ── ASK MODE — a grounded prose answer + clickable candidates ── */}
      {res && res.mode === "ask" && (
        <div className="mt-2">
          <div
            className="p-3 text-[13px]"
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--w)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}
          >
            {res.answer || "—"}
          </div>
          {res.candidates && res.candidates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {res.candidates.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  onClick={() => onOpen(c.uid)}
                  className="px-2.5 py-1 text-[12px] font-medium inline-flex items-center gap-1 transition-opacity hover:opacity-80"
                  style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)" }}
                >
                  <User size={11} strokeWidth={2} style={{ color: "var(--w3)" }} /> {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LIST MODE — candidate results ── */}
      {res && res.mode !== "ask" && (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>
              {res.empty
                ? L(`All ${res.matched ?? 0}`, `Tous (${res.matched ?? 0})`, `Alle ${res.matched ?? 0}`)
                : res.matched === 1
                  ? L("1 candidate", "1 candidat", "1 Kandidat")
                  : L(`${res.matched ?? 0} candidates`, `${res.matched ?? 0} candidats`, `${res.matched ?? 0} Kandidaten`)}
            </span>
            {(res.filter ?? []).map((chip, i) => (
              <span key={i} className="px-2 py-0.5 text-[11px]" style={{ borderRadius: 6, border: "1px solid var(--border)", color: "var(--w2)", background: "var(--card)" }}>
                {chip}
              </span>
            ))}
          </div>

          {(res.results ?? []).length === 0 ? (
            <div className="flex items-center gap-2 py-3 text-[12.5px]" style={{ color: "var(--w3)" }}>
              <SearchX size={15} strokeWidth={1.8} />
              {L("No matches. Try rephrasing.", "Aucun résultat. Reformulez.", "Keine Treffer. Anders formulieren.")}
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto pr-0.5">
              {(res.results ?? []).map((h) => (
                <button
                  key={h.uid}
                  type="button"
                  onClick={() => onOpen(h.uid)}
                  className="flex items-center gap-2.5 p-2 text-left transition-colors"
                  style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg2)" }}
                >
                  {/* Avatar */}
                  {h.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.photo} alt="" width={34} height={34} className="rounded-full object-cover" style={{ width: 34, height: 34, flexShrink: 0 }} />
                  ) : (
                    <span
                      className="inline-flex items-center justify-center rounded-full font-semibold"
                      style={{ width: 34, height: 34, flexShrink: 0, background: "var(--card)", border: `2px solid ${h.stageColor}`, color: "var(--w2)", fontSize: 13 }}
                    >
                      {(h.name || "?").trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{h.name}</span>
                      {h.pendingDocs > 0 && (
                        <span className="px-1.5 rounded-full text-[9.5px] font-bold" style={{ background: "#f59e0b", color: "#1a1205", flexShrink: 0 }} title={L("pending documents", "documents en attente", "offene Dokumente")}>
                          {h.pendingDocs}
                        </span>
                      )}
                    </span>
                    {h.sub && <span className="block text-[11px] truncate" style={{ color: "var(--w3)" }}>{h.sub}</span>}
                    {h.why && <span className="block text-[11px] truncate" style={{ color: "var(--w2)" }}>{h.why}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
