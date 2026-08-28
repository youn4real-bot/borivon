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
import { Sparkles, Loader2, X as XIcon, CornerDownLeft, SearchX, User } from "lucide-react";

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

  const examples: string[] = [
    L("B2 certified this year", "certifié B2 cette année", "dieses Jahr B2 zertifiziert"),
    L("interview next week", "entretien la semaine prochaine", "nächste Woche Gespräch"),
    L("ICU nurses, 3+ years", "infirmiers soins intensifs, 3+ ans", "Intensivpflege, 3+ Jahre"),
    L("stuck at passport review", "bloqué à la revue du passeport", "hängt bei der Passprüfung"),
    L("what needs me today", "qu'est-ce qui m'attend aujourd'hui", "was braucht mich heute"),
  ];

  const runExample = (ex: string) => { setQ(ex); void runSearch(ex); };

  return (
    <div
      className="mb-3"
      role="search"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border-gold)",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 0 0 1px var(--gdim) inset",
      }}
    >
      {/* Bar */}
      <div className="flex items-center gap-2">
        <Sparkles size={16} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void runSearch(q); }
            else if (e.key === "Escape") { e.preventDefault(); clearAll(); }
          }}
          aria-label={L("Ask for candidates in plain language", "Demandez des candidats en langage naturel", "Kandidaten in normaler Sprache suchen")}
          placeholder={L(
            "Find candidates or ask about one — e.g. B2 this year, or what does Hajar still need?",
            "Trouvez des candidats ou posez une question — ex. B2 cette année, ou que manque-t-il à Hajar ?",
            "Kandidaten finden oder fragen — z. B. B2 dieses Jahr, oder was fehlt Hajar noch?",
          )}
          className="flex-1 min-w-0 outline-none bg-transparent placeholder:opacity-40"
          style={{ color: "var(--w)", fontSize: 13.5, height: 30 }}
        />
        {(q || res) && (
          <button
            type="button"
            onClick={clearAll}
            aria-label={L("Clear", "Effacer", "Löschen")}
            className="p-1 rounded-md transition-opacity hover:opacity-100 opacity-60"
            style={{ color: "var(--w3)" }}
          >
            <XIcon size={15} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void runSearch(q)}
          disabled={loading || !q.trim()}
          className="inline-flex items-center gap-1.5 px-3 font-semibold transition-opacity disabled:opacity-40"
          style={{
            height: 30,
            borderRadius: 8,
            fontSize: 12.5,
            background: "var(--gold)",
            color: "#1a1205",
            flexShrink: 0,
          }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" strokeWidth={2.4} /> : <CornerDownLeft size={13} strokeWidth={2.4} />}
          {L("Search", "Chercher", "Suchen")}
        </button>
      </div>

      {/* Example chips — shown until the first search runs */}
      {!res && !loading && !error && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--w3)" }}>
            {L("Try", "Essayez", "Beispiele")}
          </span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => runExample(ex)}
              className="px-2 py-0.5 text-[11.5px] transition-colors"
              style={{ borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--w2)" }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-2 text-[12px]" style={{ color: "var(--w2)" }}>{error}</div>
      )}

      {/* ── ASK MODE — a grounded prose answer + clickable candidates ── */}
      {res && res.mode === "ask" && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span
              className="px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide inline-flex items-center gap-1"
              style={{ borderRadius: 999, background: "var(--gdim)", color: "var(--gold)" }}
            >
              <Sparkles size={9} strokeWidth={2.4} />
              {L("Answer", "Réponse", "Antwort")}
            </span>
          </div>
          <div
            className="p-3 text-[13px]"
            style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--w)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}
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
                  className="px-2 py-1 text-[11.5px] font-semibold inline-flex items-center gap-1 transition-opacity"
                  style={{ borderRadius: 999, border: "1px solid var(--border-gold)", background: "var(--gdim)", color: "var(--gold)" }}
                >
                  <User size={11} strokeWidth={2} /> {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LIST MODE — candidate cards ── */}
      {res && res.mode !== "ask" && (
        <div className="mt-3">
          {/* Summary row: count + how it was parsed + filter chips */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[12px] font-semibold" style={{ color: "var(--w)" }}>
              {res.empty
                ? L(`Showing all ${res.matched ?? 0}`, `Tous les ${res.matched ?? 0}`, `Alle ${res.matched ?? 0}`)
                : res.matched === 1
                  ? L("1 candidate", "1 candidat", "1 Kandidat")
                  : L(`${res.matched ?? 0} candidates`, `${res.matched ?? 0} candidats`, `${res.matched ?? 0} Kandidaten`)}
            </span>
            <span
              className="px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide inline-flex items-center gap-1"
              style={{ borderRadius: 999, background: "var(--gdim)", color: res.usedAI ? "var(--gold)" : "var(--w3)" }}
              title={res.usedAI
                ? L("Understood by AI", "Interprété par l'IA", "Von KI verstanden")
                : L("Matched by keywords", "Par mots-clés", "Per Stichwort")}
            >
              {res.usedAI ? <Sparkles size={9} strokeWidth={2.4} /> : null}
              {res.usedAI ? L("AI", "IA", "KI") : L("keyword", "mot-clé", "Stichwort")}
            </span>
            {res.empty && (
              <span className="text-[11px]" style={{ color: "var(--w3)" }}>
                {L("(no specific filter detected)", "(aucun filtre précis détecté)", "(kein konkreter Filter erkannt)")}
              </span>
            )}
            {(res.filter ?? []).map((chip, i) => (
              <span key={i} className="px-2 py-0.5 text-[11px]" style={{ borderRadius: 999, border: "1px solid var(--border-gold)", color: "var(--gold)", background: "var(--gdim)" }}>
                {chip}
              </span>
            ))}
          </div>

          {/* Hits */}
          {(res.results ?? []).length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-[12.5px]" style={{ color: "var(--w3)" }}>
              <SearchX size={15} strokeWidth={1.8} />
              {L("No candidates match that. Try rephrasing.", "Aucun candidat ne correspond. Reformulez.", "Keine Treffer. Anders formulieren.")}
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
                    {h.why && <span className="block text-[11px] truncate" style={{ color: "var(--gold)" }}>{h.why}</span>}
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
