"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal } from "@/components/ui/Modal";
import { RefreshCw, MessageCircle, Copy, Check, PhoneOff, Mail, MessageSquareText } from "lucide-react";
import { PageHead, Btn, Card, Seg, Dot, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT, type Status as KitStatus } from "@/components/fx/kit";

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

// Colour carries the urgency, the way status does everywhere else (LAW #4) — the one palette
// (components/fx/kit): red = blocked, orange = soon / waiting, no tint = gone quiet.
const TONE: Record<Reason, KitStatus> = {
  id_card_not_passport: "rejected",
  passport_expired:     "rejected",
  passport_expiring:    "pending",
  doc_rejected:         "pending",
  stalled:              "missing",
  // Orange, not red: nothing is broken for HER — she simply never got in, and one
  // message fixes it. It is an opportunity, not an emergency.
  never_confirmed:      "pending",
};

// The page's own small classes: one tinted row per person (the tint is the urgency), the
// WhatsApp text one tap away. Phone: name over reason, the three actions as icons.
const CHASE_CSS = `
.chs-row{display:flex;align-items:center;gap:12px;padding:7px 8px 7px 14px;border-radius:12px;border:1px solid transparent}
.chs-main{flex:1;min-width:0}
.chs-l1{display:flex;align-items:baseline;gap:10px;min-width:0}
.chs-who{background:none;border:0;padding:0;font-family:inherit;font-size:14px;font-weight:500;color:var(--w);cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.chs-who:hover{text-decoration:underline;text-underline-offset:3px}
.chs-tag{flex:none;font-size:12px;color:var(--w3);white-space:nowrap}
.chs-l2{margin-top:2px;font-size:12.5px;color:var(--w3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chs-l2 b{font-weight:600;color:var(--w)}
.chs-act{flex:none;display:flex;align-items:center;gap:4px}
.chs-wa{text-decoration:none}
.chs-show-ph{display:none}
.chs-switch{position:relative;flex:none;width:40px;height:22px;border-radius:999px;border:1px solid var(--border2);cursor:pointer;padding:0;transition:background .15s}
.chs-switch:disabled{opacity:.4;cursor:default}
.chs-switch>i{position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:var(--card);box-shadow:0 1px 3px rgba(21,19,15,.25);transition:left .15s}
@media (max-width:640px){
.chs-row{gap:8px;padding:8px 6px 8px 12px}
.chs-tag-batch{display:none}
.chs-hide-ph{display:none!important}
.chs-show-ph{display:inline}
.chs-ib{width:34px;padding:0!important}
.chs-act{gap:2px}
}`;

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

  // the reason filters that are not one of the three tabs (shown in one quiet select)
  const reasonOpts = (Object.keys(REASON_LABEL) as Reason[]).filter((k) => (counts[k] ?? 0) > 0);
  const isReason = filter !== "all" && filter !== "action" && filter !== "batch";

  // One person who holds something up: the tint is the urgency (LAW #4), the actions are compose-only.
  const chaseRow = (r: Row, onMessage: () => void, narrow: boolean) => (
    <div key={r.userId + r.reason} className="chs-row"
      style={{ background: TONE[r.reason] === "missing" ? "var(--card)" : STATUS_TINT[TONE[r.reason]], borderColor: TONE[r.reason] === "missing" ? "var(--border)" : "transparent" }}>
      <div className="chs-main">
        <div className="chs-l1">
          <button type="button" className="chs-who" onClick={() => router.push(`/portal/admin?candidate=${r.userId}`)}>{r.name}</button>
          {r.batch && <span className="chs-tag chs-tag-batch">{r.batch}</span>}
          {r.placementReady && (
            <span className="chs-tag" style={{ fontWeight: 600, color: STATUS_DOT.rejected }}>{T("marked ready", "als bereit markiert", "marquée prête")}</span>
          )}
        </div>
        <div className="chs-l2" title={`${REASON_LABEL[r.reason]} — ${r.detail}`}>
          <b>{REASON_LABEL[r.reason]}</b> · {r.detail}
        </div>
      </div>
      <div className="chs-act">
        {r.waLink ? (
          <a href={r.waLink} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
            className={`bvk-btn bvk-ghost bvk-sm chs-wa${narrow ? " chs-ib" : ""}`}>
            <MessageCircle size={14} strokeWidth={2.2} style={{ color: "#25D366" }} />{!narrow && "WhatsApp"}
          </a>
        ) : (
          <span className={`bvk-btn bvk-quiet bvk-sm${narrow ? " chs-ib" : ""}`} style={{ cursor: "default" }}
            title={T("No usable phone number on file", "Keine brauchbare Telefonnummer hinterlegt", "Aucun numéro utilisable au dossier")}
            aria-label={T("No number", "Keine Nummer", "Pas de numéro")}>
            <PhoneOff size={13} />{!narrow && T("No number", "Keine Nummer", "Pas de numéro")}
          </span>
        )}
        <Btn kind="quiet" size="sm" className={narrow ? "chs-ib" : undefined} onClick={() => copy(r)}
          aria-label={T("Copy text", "Text kopieren", "Copier")} title={T("Copy text", "Text kopieren", "Copier")}>
          {copied === r.userId
            ? <><Check size={13} style={{ color: STATUS_DOT.approved }} />{!narrow && T("Copied", "Kopiert", "Copié")}</>
            : <><Copy size={13} />{!narrow && T("Copy text", "Text kopieren", "Copier")}</>}
        </Btn>
        <Btn kind="quiet" size="sm" icon className="chs-msg" onClick={onMessage}
          aria-label={T("See the message", "Nachricht ansehen", "Voir le message")} title={T("See the message", "Nachricht ansehen", "Voir le message")}>
          <MessageSquareText size={15} />
        </Btn>
      </div>
    </div>
  );

  return (
    <main id="main" className="mx-auto px-5 bv-page-bottom" style={{ maxWidth: 900, paddingTop: 88, paddingBottom: 20 }}>
      <style>{CHASE_CSS}</style>
      <PageHead
        back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Chase list", "Nachfassliste", "À relancer")}
        sub={<>
          <span className="chs-hide-ph">{T("Who is holding something up, most urgent first. Tap WhatsApp — the message is already written in her language.",
            "Wer etwas aufhält, dringendste zuerst. WhatsApp antippen — die Nachricht steht schon in ihrer Sprache.",
            "Qui bloque quelque chose, le plus urgent d'abord. Touchez WhatsApp — le message est déjà dans sa langue.")}</span>
          <span className="chs-show-ph">{T("Most urgent first — the message is ready.", "Dringendste zuerst — die Nachricht ist fertig.", "Le plus urgent d'abord — le message est prêt.")}</span>
        </>}
        actions={
          <Btn size="sm" onClick={() => token && load(token)} disabled={busy} aria-label={T("Refresh", "Aktualisieren", "Actualiser")}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />{T("Refresh", "Aktualisieren", "Actualiser")}
          </Btn>
        }
      />

      {rem && (
        <Card style={{ padding: "12px 14px 12px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Mail size={16} style={{ color: rem.enabled ? "var(--gold)" : "var(--w3)", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--w)" }}>
                {T("Automatic email reminders", "Automatische E-Mail-Erinnerungen", "Rappels automatiques par e-mail")}
              </p>
              <p style={{ margin: "1px 0 0", fontSize: 12.5, color: "var(--w3)" }}>
                {T("Missing or refused document → a short email in her language, at most once a week, 3 times.",
                   "Fehlendes oder abgelehntes Dokument → kurze E-Mail in ihrer Sprache, max. 1× pro Woche, 3×.",
                   "Document manquant ou refusé → court e-mail dans sa langue, 1× par semaine max, 3×.")}
                {!(!rem.tableReady && rem.canToggle) && rem.due.length > 0 && (
                  <>
                    {" "}
                    <button type="button" onClick={() => setRemOpen(o => !o)}
                      style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 500, color: "var(--w)", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
                      {rem.enabled
                        ? T(`${rem.due.length} will get one at 11:00`, `${rem.due.length} bekommen eine um 11:00`, `${rem.due.length} en recevront un à 11h00`)
                        : T(`${rem.due.length} would get one`, `${rem.due.length} würden eine bekommen`, `${rem.due.length} en recevraient un`)}
                      {" · "}{remOpen ? T("Hide", "Ausblenden", "Masquer") : T("See who", "Wer?", "Qui ?")}
                    </button>
                  </>
                )}
              </p>
              {!rem.tableReady && rem.canToggle && (
                <p style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 0", fontSize: 12.5, color: "var(--w2)" }}>
                  <Dot st="pending" size={7} />
                  {T("Needs a one-time database setup before it can be turned on.",
                     "Braucht vor dem Einschalten eine einmalige Datenbank-Einrichtung.",
                     "Nécessite une configuration unique de la base avant activation.")}
                </p>
              )}
            </div>
            <button type="button" role="switch" aria-checked={rem.enabled}
              aria-label={T("Automatic email reminders", "Automatische E-Mail-Erinnerungen", "Rappels automatiques par e-mail")}
              onClick={toggleReminders} disabled={!rem.canToggle || !rem.tableReady || remBusy}
              className="chs-switch" style={{ background: rem.enabled ? STATUS_DOT.approved : "var(--bg2)", borderColor: rem.enabled ? STATUS_DOT.approved : "var(--border2)" }}>
              <i style={{ left: rem.enabled ? 20 : 2 }} />
            </button>
          </div>

          {/* who gets one — the universal popup (LAW #36) instead of a list that grows the page */}
          <Modal open={remOpen && rem.due.length > 0 && !(!rem.tableReady && rem.canToggle)} onClose={() => setRemOpen(false)} size="sm"
            title={T("Automatic email reminders", "Automatische E-Mail-Erinnerungen", "Rappels automatiques par e-mail")}
            subtitle={rem.enabled
              ? T(`${rem.due.length} will get one at 11:00`, `${rem.due.length} bekommen eine um 11:00`, `${rem.due.length} en recevront un à 11h00`)
              : T(`${rem.due.length} would get one`, `${rem.due.length} würden eine bekommen`, `${rem.due.length} en recevraient un`)}>
            <div className="px-5 py-4" style={{ display: "grid", gap: 4 }}>
              {rem.due.map(d => (
                <div key={d.userId} className="bvk-row" style={{ display: "block", padding: "9px 2px" }}>
                  <button type="button" onClick={() => router.push(`/portal/admin?candidate=${d.userId}`)}
                    style={{ background: "none", border: 0, padding: 0, font: "inherit", fontSize: 14, fontWeight: 500, color: "var(--w)", cursor: "pointer", textAlign: "left" }}>
                    {d.name}
                  </button>
                  <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--w3)" }}>
                    {d.items.map((it, i) => (
                      <span key={i} style={{ color: it.kind === "rejected" ? STATUS_DOT.rejected : undefined }}>
                        {i > 0 ? ", " : ""}{it.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        </Card>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Seg value={filter} onChange={(v) => setFilter(v)}
          options={([
            ["batch",  `${T("In a batch", "Im Batch", "Dans un lot")} ${batchCount}`, batchCount],
            ["action", `${T("Needs action", "Zu erledigen", "À traiter")} ${actionCount}`, actionCount],
            ["all",    `${T("Everyone", "Alle", "Tout le monde")} ${rows.length}`, rows.length],
          ] as [Reason | "all" | "action" | "batch", string, number][])
            .filter(([, , n]) => n > 0)
            .map(([k, label]) => [k, label] as [Reason | "all" | "action" | "batch", string])} />
        {reasonOpts.length > 0 && (
          <select value={isReason ? filter : ""} onChange={(e) => { if (e.target.value) setFilter(e.target.value as Reason); }}
            aria-label={T("By reason", "Nach Grund", "Par motif")} className="bvk-input"
            style={{ height: 34, width: "auto", maxWidth: "100%", borderRadius: 999, padding: "0 12px", fontSize: 13, background: isReason ? "var(--card)" : "transparent" }}>
            <option value="">{T("By reason…", "Nach Grund…", "Par motif…")}</option>
            {reasonOpts.map((k) => <option key={k} value={k}>{REASON_LABEL[k]} {counts[k]}</option>)}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <Card>
          <Empty>{T("Nobody is waiting on you. ", "Niemand wartet auf dich. ", "Personne n'attend après vous. ")}</Empty>
        </Card>
      ) : (
        <ChaseList rows={shown} row={chaseRow} T={T} copied={copied} onCopy={copy} />
      )}
    </main>
  );
}

/** The chase list, one page at a time (nobody scrolls); the finished message opens in the popup. */
function ChaseList({ rows, row, T, copied, onCopy }: {
  rows: Row[];
  row: (r: Row, onMessage: () => void, narrow: boolean) => React.ReactNode;
  T: (en: string, de: string, fr: string) => string;
  copied: string | null;
  onCopy: (r: Row) => void;
}) {
  const { slice, page, pages, setPage, narrow } = usePaged(rows, 5, 3);
  const [msgKey, setMsgKey] = useState<string | null>(null);
  const msg = msgKey ? rows.find((r) => r.userId + r.reason === msgKey) ?? null : null;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((r) => row(r, () => setMsgKey(r.userId + r.reason), narrow))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      <Modal open={!!msg} onClose={() => setMsgKey(null)} size="sm"
        title={T("See the message", "Nachricht ansehen", "Voir le message")} subtitle={msg ? msg.name : ""}
        footer={msg ? (
          <>
            <Btn kind="quiet" size="sm" onClick={() => onCopy(msg)}>
              {copied === msg.userId
                ? <><Check size={13} style={{ color: STATUS_DOT.approved }} />{T("Copied", "Kopiert", "Copié")}</>
                : <><Copy size={13} />{T("Copy text", "Text kopieren", "Copier")}</>}
            </Btn>
            {msg.waLink && (
              <a href={msg.waLink} target="_blank" rel="noopener noreferrer" className="bvk-btn bvk-primary bvk-sm" style={{ textDecoration: "none" }}>
                <MessageCircle size={14} strokeWidth={2.2} />WhatsApp
              </a>
            )}
          </>
        ) : undefined}>
        {msg && (
          <div className="px-5 py-4">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, color: "var(--w)" }}>{msg.message}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
