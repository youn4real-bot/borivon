"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, RefreshCw, MessageCircle, Copy, Check, PhoneOff, Mail } from "lucide-react";

type Reason = "passport_expired" | "passport_expiring" | "id_card_not_passport" | "doc_rejected" | "stalled" | "never_confirmed";
type Row = {
  userId: string; name: string; reason: Reason; detail: string; urgency: number;
  placementReady: boolean; phone: string | null; lang: string; message: string; waLink: string;
  batch: string | null;
};

/** The automatic email reminders (lib/docRemindersRun) — state + who's next. */
type Reminders = {
  enabled: boolean; tableReady: boolean; canToggle: boolean;
  due: { userId: string; name: string; items: { kind: "rejected" | "missing"; label: string }[] }[];
};

// Colour carries the urgency, the way status does everywhere else (LAW #4).
const TONE: Record<Reason, { fg: string; bg: string; bd: string }> = {
  id_card_not_passport: { fg: "var(--danger)",  bg: "var(--danger-bg)",  bd: "var(--danger-border)" },
  passport_expired:     { fg: "var(--danger)",  bg: "var(--danger-bg)",  bd: "var(--danger-border)" },
  passport_expiring:    { fg: "var(--gold)",    bg: "var(--gdim)",       bd: "var(--border-gold)" },
  doc_rejected:         { fg: "var(--gold)",    bg: "var(--gdim)",       bd: "var(--border-gold)" },
  stalled:              { fg: "var(--w2)",      bg: "var(--bg2)",        bd: "var(--border)" },
  // Gold, not red: nothing is broken for HER — she simply never got in, and one
  // message fixes it. It is an opportunity, not an emergency.
  never_confirmed:      { fg: "var(--gold)",    bg: "var(--gdim)",       bd: "var(--border-gold)" },
};

export default function ChasePage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Default to IN A BATCH. The founder chases the intake, not the roster: a
  // candidate with no batch has no seat to be late for, so putting them in the
  // same list as someone holding up UKSH Kiel is what made the first version
  // unusable. Everyone else stays one tap away rather than hidden — a real
  // blocker on an unbatched candidate should still be findable.
  const [filter, setFilter] = useState<Reason | "all" | "action" | "batch">("batch");
  const [rem, setRem] = useState<Reminders | null>(null);
  const [remBusy, setRemBusy] = useState(false);
  const [remOpen, setRemOpen] = useState(false);

  const REASON_LABEL: Record<Reason, string> = {
    id_card_not_passport: T("Sent an ID card, not a passport", "Personalausweis statt Reisepass", "A envoyé une carte d'identité, pas un passeport"),
    passport_expired:     T("Passport expired", "Reisepass abgelaufen", "Passeport expiré"),
    passport_expiring:    T("Passport expiring", "Reisepass läuft ab", "Passeport bientôt expiré"),
    doc_rejected:         T("Document refused, not re-sent", "Dokument abgelehnt, nicht neu geschickt", "Document refusé, non renvoyé"),
    stalled:              T("Gone quiet", "Keine Reaktion", "Sans nouvelles"),
    never_confirmed:      T("Never got in", "Nie reingekommen", "N'a jamais pu entrer"),
  };

  async function load(tk: string) {
    setBusy(true);
    try {
      const [r, rr] = await Promise.all([
        fetch("/api/portal/admin/chase", { headers: { Authorization: `Bearer ${tk}` } }),
        fetch(`/api/portal/admin/doc-reminders?lang=${lang}`, { headers: { Authorization: `Bearer ${tk}` } }),
      ]);
      const j = await r.json().catch(() => ({}));
      setRows(Array.isArray(j?.rows) ? j.rows : []);
      const rj = rr.ok ? await rr.json().catch(() => null) : null;
      setRem(rj && Array.isArray(rj.due) ? rj as Reminders : null);
    } finally { setBusy(false); }
  }

  async function toggleReminders() {
    if (!rem?.canToggle || !rem.tableReady || remBusy) return;
    setRemBusy(true);
    try {
      const r = await fetch("/api/portal/admin/doc-reminders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rem.enabled }),
      });
      if (r.ok) setRem(s => (s ? { ...s, enabled: !s.enabled } : s));
    } finally { setRemBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      if (cancelled) return;
      setToken(tk);
      // Borivon team + agency admins. The API scopes what each one sees.
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const rj = await roleRes.json().catch(() => ({}));
      if (rj?.role !== "admin" && rj?.role !== "sub_admin") { router.replace("/portal"); return; }
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) return <PageLoader />;

  const shown = filter === "all" ? rows
    : filter === "batch" ? rows.filter(r => r.batch)
    : filter === "action" ? rows.filter(r => r.reason !== "stalled")
    : rows.filter(r => r.reason === filter);
  const counts = rows.reduce<Record<string, number>>((a, r) => { a[r.reason] = (a[r.reason] ?? 0) + 1; return a; }, {});
  const actionCount = rows.filter(r => r.reason !== "stalled").length;
  const batchCount = rows.filter(r => r.batch).length;

  async function copy(r: Row) {
    try {
      await navigator.clipboard.writeText(r.message);
      setCopied(r.userId);
      setTimeout(() => setCopied(c => (c === r.userId ? null : c)), 1800);
    } catch { /* clipboard blocked — the WhatsApp button still carries the text */ }
  }

  return (
    <main id="main" className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={() => router.push("/portal/admin")} aria-label={T("Back", "Zurück", "Retour")}
          className="w-9 h-9 flex items-center justify-center rounded-full" style={{ color: "var(--w2)" }}>
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>
          {T("Chase list", "Nachfassliste", "À relancer")}
        </h1>
        <button onClick={() => token && load(token)} disabled={busy} aria-label={T("Refresh", "Aktualisieren", "Actualiser")}
          className="ml-auto w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-40" style={{ color: "var(--w2)" }}>
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
        </button>
      </div>

      <p className="text-[12px] mb-4" style={{ color: "var(--w3)" }}>
        {T("Candidates in an employer batch who are holding something up, most urgent first. Tap WhatsApp — the message is already written in her language; you just press send.",
           "Kandidatinnen in einem Arbeitgeber-Batch, bei denen etwas offen ist, dringendste zuerst. Auf WhatsApp tippen — die Nachricht ist bereits in ihrer Sprache verfasst, du drückst nur auf Senden.",
           "Candidates d'un lot employeur qui bloquent quelque chose, les plus urgentes d'abord. Touchez WhatsApp — le message est déjà rédigé dans sa langue, vous n'avez qu'à l'envoyer.")}
      </p>

      {rem && (
        <div className="rounded-2xl p-3.5 mb-4" style={{ background: "var(--card)", border: `1px solid ${rem.enabled ? "var(--border-gold)" : "var(--border)"}` }}>
          <div className="flex items-center gap-3">
            <Mail size={16} style={{ color: rem.enabled ? "var(--gold)" : "var(--w3)", flexShrink: 0 }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold" style={{ color: "var(--w)" }}>
                {T("Automatic email reminders", "Automatische E-Mail-Erinnerungen", "Rappels automatiques par e-mail")}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                {T("A missing or refused document gets a short email in her language. At most once a week, 3 times max.",
                   "Fehlt ein Dokument oder wurde es abgelehnt, kommt eine kurze E-Mail in ihrer Sprache. Höchstens einmal pro Woche, maximal 3-mal.",
                   "Un document manquant ou refusé déclenche un court e-mail dans sa langue. Au plus une fois par semaine, 3 fois maximum.")}
              </p>
            </div>
            <button role="switch" aria-checked={rem.enabled}
              aria-label={T("Automatic email reminders", "Automatische E-Mail-Erinnerungen", "Rappels automatiques par e-mail")}
              onClick={toggleReminders} disabled={!rem.canToggle || !rem.tableReady || remBusy}
              className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-40"
              style={{ width: 40, height: 22, background: rem.enabled ? "var(--gold)" : "var(--bg2)", border: "1px solid var(--border2)" }}>
              <span className="absolute top-[2px] rounded-full transition-all"
                style={{ width: 16, height: 16, left: rem.enabled ? 20 : 2, background: rem.enabled ? "#131312" : "var(--w3)" }} />
            </button>
          </div>

          {!rem.tableReady && rem.canToggle ? (
            <p className="text-[11px] mt-2" style={{ color: "var(--gold)" }}>
              {T("Needs a one-time database setup before it can be turned on.",
                 "Braucht vor dem Einschalten eine einmalige Datenbank-Einrichtung.",
                 "Nécessite une configuration unique de la base avant activation.")}
            </p>
          ) : rem.due.length > 0 && (
            <>
              <button onClick={() => setRemOpen(o => !o)} className="text-[11px] mt-2 hover:underline" style={{ color: "var(--w2)" }}>
                {rem.enabled
                  ? T(`${rem.due.length} will get one at 11:00`, `${rem.due.length} bekommen eine um 11:00`, `${rem.due.length} en recevront un à 11h00`)
                  : T(`${rem.due.length} would get one`, `${rem.due.length} würden eine bekommen`, `${rem.due.length} en recevraient un`)}
                {" · "}{remOpen ? T("Hide", "Ausblenden", "Masquer") : T("See who", "Wer?", "Qui ?")}
              </button>
              {remOpen && (
                <div className="mt-2 space-y-1.5">
                  {rem.due.map(d => (
                    <div key={d.userId} className="text-[11px]" style={{ color: "var(--w3)" }}>
                      <button onClick={() => router.push(`/portal/admin?candidate=${d.userId}`)}
                        className="font-semibold hover:underline" style={{ color: "var(--w)" }}>{d.name}</button>
                      {" — "}
                      {d.items.map((it, i) => (
                        <span key={i} style={{ color: it.kind === "rejected" ? "var(--danger)" : undefined }}>
                          {i > 0 ? ", " : ""}{it.label}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {([
          ["batch",  T("In a batch", "Im Batch", "Dans un lot"), batchCount],
          ["action", T("Needs action", "Zu erledigen", "À traiter"), actionCount],
          ...(Object.keys(REASON_LABEL) as Reason[]).map(k => [k, REASON_LABEL[k], counts[k] ?? 0] as const),
          ["all", T("Everyone", "Alle", "Tout le monde"), rows.length],
        ] as [Reason | "all" | "action" | "batch", string, number][])
          .filter(([, , n]) => n > 0)
          .map(([k, label, n]) => (
            <button key={k} onClick={() => setFilter(k)}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-opacity hover:opacity-80"
              style={filter === k
                ? { background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }
                : { background: "var(--card)", color: "var(--w2)", border: "1px solid var(--border)" }}>
              {label} {n}
            </button>
          ))}
      </div>

      {shown.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="text-[13px]" style={{ color: "var(--w2)" }}>
            {T("Nobody is waiting on you. ", "Niemand wartet auf dich. ", "Personne n'attend après vous. ")}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map(r => {
          const tone = TONE[r.reason];
          return (
            <div key={r.userId + r.reason} className="rounded-2xl p-3.5"
              style={{ background: "var(--card)", border: `1px solid ${tone.bd}` }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => router.push(`/portal/admin?candidate=${r.userId}`)}
                      className="text-[14px] font-bold text-left hover:underline" style={{ color: "var(--w)" }}>
                      {r.name}
                    </button>
                    {r.batch && (
                      <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                        {r.batch}
                      </span>
                    )}
                    {r.placementReady && (
                      <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                        {T("MARKED READY", "ALS BEREIT MARKIERT", "MARQUÉE PRÊTE")}
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] mt-0.5 font-semibold" style={{ color: tone.fg }}>{REASON_LABEL[r.reason]}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>{r.detail}</p>
                </div>

                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {r.waLink ? (
                    <a href={r.waLink} target="_blank" rel="noopener noreferrer"
                      className="min-h-[44px] px-3 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-85"
                      style={{ background: "#25D366", color: "#06251A" }}>
                      <MessageCircle size={14} strokeWidth={2.2} /> WhatsApp
                    </a>
                  ) : (
                    <span className="min-h-[44px] px-3 rounded-xl text-[11px] font-medium flex items-center gap-1.5"
                      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}
                      title={T("No usable phone number on file", "Keine brauchbare Telefonnummer hinterlegt", "Aucun numéro utilisable au dossier")}>
                      <PhoneOff size={13} /> {T("No number", "Keine Nummer", "Pas de numéro")}
                    </span>
                  )}
                  <button onClick={() => copy(r)}
                    className="min-h-[36px] px-3 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1.5 transition-opacity hover:opacity-80"
                    style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    {copied === r.userId ? <><Check size={12} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={12} /> {T("Copy text", "Text kopieren", "Copier")}</>}
                  </button>
                </div>
              </div>

              <details className="mt-2">
                <summary className="text-[11px] cursor-pointer select-none" style={{ color: "var(--w3)" }}>
                  {T("See the message", "Nachricht ansehen", "Voir le message")}
                </summary>
                <pre className="mt-1.5 text-[11px] whitespace-pre-wrap font-sans rounded-xl p-2.5"
                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>{r.message}</pre>
              </details>
            </div>
          );
        })}
      </div>
    </main>
  );
}
