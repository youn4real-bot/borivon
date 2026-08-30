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
import { Search, Loader2, X as XIcon, User } from "lucide-react";

type Hit = { uid: string };
type SearchResponse = {
  ok: boolean;
  mode?: "list" | "ask";
  results?: Hit[];
  // ask mode
  answer?: string;
  candidates?: { uid: string; name: string }[];
};

export function AdminSmartSearch({
  accessToken,
  lang,
  onOpen,
  onResults,
  onQueryChange,
}: {
  accessToken: string;
  lang: string;
  onOpen: (uid: string) => void;
  /** Matching candidate uids for a plain search → the page filters its ONE list to
   *  them (unified). null = no active search (restore the previous list). */
  onResults: (uids: string[] | null) => void;
  /** Fires on every keystroke so the page can filter its list LIVE (instant
   *  name/email/phone match). Enter still runs the AI search via onResults. */
  onQueryChange: (text: string) => void;
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
      if (!text) { setRes(null); setError(null); onResults(null); return; }
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
          setRes(null); onResults(null);
          return;
        }
        const data = (await r.json()) as SearchResponse & { error?: string };
        // The route degrades to a 200 with ok:false rather than a 500 — show it.
        if (data.ok === false) {
          setError(data.error || L("Search is temporarily unavailable — try again.", "Recherche momentanément indisponible — réessayez.", "Suche vorübergehend nicht verfügbar — erneut versuchen."));
          setRes(null); onResults(null);
          return;
        }
        if (data.mode === "ask") {
          // A question → keep the prose answer in the bar; don't touch the list.
          setRes(data); onResults(null);
        } else {
          // A search → feed the matches into the ONE candidate list below (unified);
          // the bar renders no list of its own.
          setRes(null); onResults((data.results ?? []).map((h) => h.uid));
        }
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError(L("Search failed — try again.", "Échec de la recherche — réessayez.", "Suche fehlgeschlagen — erneut versuchen."));
        onResults(null);
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
    onQueryChange("");
    onResults(null); // restore the previous (batch / general) list
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
          onChange={(e) => { setQ(e.target.value); setRes(null); onQueryChange(e.target.value); }}
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

      {/* List-mode results are rendered by the page's ONE candidate list (unified),
          not here — the bar only feeds it uids via onResults. */}
    </div>
  );
}
