"use client";

/**
 * Besucher & Quellen (SUPREME ADMIN ONLY, founder 2026-11-09): where people come from, how far
 * they get (link → Fahrplan → request → confirm → PDF → workshop → booking), where they drop off,
 * and tracked links for every post / video / mail. Data: /api/portal/admin/traffic (first-party,
 * no cookies, see lib/track/server.ts).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PageLoader } from "@/components/ui/states";
import { Copy, Check, Link2, EyeOff, Eye } from "lucide-react";
import { PageHead, Btn, Card, Seg, Dot, Pager, usePaged, STATUS_TINT, STATUS_DOT } from "@/components/fx/kit";

type R = Record<string, unknown>;
type Data = {
  days: number; totals: R; sources: R[]; quiz: R[]; fields: R[]; answers: R[]; daily: R[];
  visits: R[]; links: R[]; leads: R[]; errors?: string[];
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const s = (v: unknown) => (v == null ? "" : String(v));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)} %` : "–");
const when = (iso: unknown) => {
  const d = new Date(s(iso));
  return isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const Q_LABEL: Record<string, string> = {
  art: "Art der Einrichtung", rolle: "Rolle", standorte: "Standorte", land: "Bundesland", plaetze: "Plätze", bedarf: "Bedarf",
  leasing: "Leasing", erfahrung: "Erfahrung Ausland", grund: "Warum gescheitert", start: "Start", datum: "Datum",
  haben: "Schon vorhanden", wer: "Wer entscheidet", kontakt: "Kontaktdaten",
};
const F_LABEL: Record<string, string> = { "c-vor": "Vorname", "c-nach": "Nachname", "c-mail": "E-Mail", "c-ok": "Einwilligung", f: "Auswahlfeld" };
const CHANNELS = [
  ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"],
  ["email", "E-Mail"], ["whatsapp", "WhatsApp"], ["xing", "Xing"], ["podcast", "Podcast"], ["ads", "Anzeige"], ["other", "Sonstiges"],
];
const TARGETS = [["/fahrplan", "Fahrplan (Formular)"], ["/workshop", "Workshop-Seite"], ["/workshop#termin", "Workshop: Kalender"], ["/", "Startseite"], ["/plattform", "Plattform"]];

// the one design: each part of the data is one view of a segmented switch (nobody scrolls)
type View = "weg" | "links" | "quellen" | "quiz" | "antworten" | "anfragen" | "besuche";
const VIEWS: [View, string][] = [["weg", "Weg"], ["links", "Links"], ["quellen", "Quellen"], ["quiz", "Quiz"], ["antworten", "Antworten"], ["anfragen", "Anfragen"], ["besuche", "Besuche"]];
const TRAFFIC_CSS = `
.bvt-funnel{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px 20px}
.bvt-form{display:grid;grid-template-columns:minmax(0,1fr) 150px 200px auto;gap:8px}
.bvt-two-col{column-count:2;column-gap:36px}
.bvt-tabs{max-width:100%;overflow-x:auto;scrollbar-width:none}
.bvt-tabs::-webkit-scrollbar{display:none}
.bvt-chart{height:80px}
.bvt-num{font-size:30px}
@media (min-width:641px){.bvt-show-sm{display:none}}
@media (max-width:640px){
.bvt-funnel{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.bvt-chart{height:48px}
.bvt-tabs{margin:0 -16px;padding:0 16px}
.bvt-num{font-size:24px}
.bvt-hide-sm{display:none}
.bvt-form{grid-template-columns:1fr 1fr}
.bvt-form .bvt-name,.bvt-form button{grid-column:1/-1}
.bvt-two-col{column-count:1}
.bvt-tabs .bvk-seg button{padding:6px 11px}
}`;

export default function TrafficPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", channel: "linkedin", target: "/fahrplan" });
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<View>("weg");

  useEffect(() => {
    try { setMine(localStorage.getItem("bv_no_track") === "1"); } catch { /* blocked */ }
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      if ((session.expires_at ?? 0) * 1000 - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep */ }
      }
      setToken(tk);
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await fetch(`/api/portal/admin/traffic?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/admin"); return; }
    const j = await res.json().catch(() => null);
    if (j && !j.error) setData(j as Data);
    setLoading(false);
  }, [token, days, router]);
  useEffect(() => { void load(); }, [load]);

  async function makeLink(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const res = await fetch("/api/portal/admin/traffic", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const j = await res.json().catch(() => ({}));
    if (j.url) { setMade(j.url); setForm((f) => ({ ...f, name: "" })); void load(); }
  }
  async function archive(code: string, archived: boolean) {
    await fetch("/api/portal/admin/traffic", {
      method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ code, archived }),
    });
    void load();
  }
  function copy(url: string) {
    void navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1400);
  }
  function toggleMine() {
    const next = !mine;
    try { if (next) localStorage.setItem("bv_no_track", "1"); else localStorage.removeItem("bv_no_track"); } catch { /* blocked */ }
    setMine(next);
  }

  const t = data?.totals ?? {};
  const funnel = useMemo(() => [
    ["Link-Klicks", n(t.clicks)], ["Besucher", n(t.visitors)], ["Fahrplan geöffnet", n(t.fahrplan)], ["Quiz begonnen", n(t.quiz)],
    ["Anfragen", n(t.submits)], ["E-Mail bestätigt", n(t.confirms)], ["PDF geöffnet", n(t.pdf)], ["Workshop-Seite", n(t.workshop)],
    ["Uhrzeit gewählt", n(t.bookPick)], ["Gebucht", n(t.bookings)],
  ] as [string, number][], [t]);
  const maxDay = Math.max(1, ...(data?.daily ?? []).map((d) => n(d.visitors)));
  const quizTop = Math.max(1, ...(data?.quiz ?? []).map((q) => n(q.reached)));
  const answerGroups = useMemo(() => {
    const g: Record<string, R[]> = {};
    for (const a of data?.answers ?? []) (g[s(a.q)] ??= []).push(a);
    return g;
  }, [data]);

  if (!data && loading) return <PageLoader />;

  const caption = (text: string) => <div className="bvt-hide-sm" style={{ fontSize: 12.5, color: "var(--w3)", margin: "0 0 10px 2px" }}>{text}</div>;
  const yes = (on: boolean, extra?: string) => on
    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Dot st="approved" size={8} />{extra}</span>
    : <span style={{ color: "var(--w3)" }}>–</span>;
  const daily = data?.daily ?? [];
  const barGap = daily.length > 120 ? 0 : daily.length > 45 ? 1 : 3;

  // the one design (founder 2026-11-13): serif head, the period + each part of the data as a segmented switch,
  // big numbers in serif, every table as hairline rows that flip — nobody scrolls. The numbers are computed as before.
  return (
    <main className="mx-auto px-4 pb-20" style={{ maxWidth: 1100, paddingTop: 84 }}>
      <style>{TRAFFIC_CSS}</style>
      <PageHead back={{ label: "Zurück", onClick: () => router.push("/portal/admin") }}
        title="Besucher & Quellen"
        actions={<>
          <Seg value={String(days)} onChange={(v) => setDays(Number(v))}
            options={[["7", "7 Tage"], ["30", "30 Tage"], ["90", "90 Tage"], ["365", "1 Jahr"]]} />
          <Btn kind="quiet" size="sm" onClick={toggleMine} title="Ihre eigenen Besuche nicht mitzählen (nur dieser Browser)" aria-label={mine ? "Dieser Browser zählt nicht" : "Mich nicht zählen"}>
            {mine ? <EyeOff size={14} /> : <Eye size={14} />} <span className="bvt-hide-sm">{mine ? "Dieser Browser zählt nicht" : "Mich nicht zählen"}</span>
          </Btn>
        </>} />

      {data?.errors?.length ? (
        <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
          Teilweise nicht geladen: {data.errors.join(" · ")}
        </div>
      ) : null}

      <div className="bvt-tabs" style={{ marginBottom: 14 }}>
        <Seg value={view} onChange={setView} options={VIEWS} />
      </div>

      {/* the whole funnel, step by step */}
      {view === "weg" && (
        <>
          {caption("Der Weg: vom Klick bis zur Buchung")}
          <Card style={{ padding: "18px 20px" }}>
            <div className="bvt-funnel">
              {funnel.map(([label, v], i) => (
                <div key={label} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 7 }}>
                    <span className="bvt-num" style={{ fontFamily: "var(--font-serif)", fontWeight: 400, lineHeight: 1.15, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                    {i > 0 && <span style={{ fontSize: 11.5, color: "var(--w3)", whiteSpace: "nowrap" }}>{pct(v, funnel[i - 1][1])}<span className="bvt-hide-sm"> vom Schritt davor</span></span>}
                  </div>
                </div>
              ))}
            </div>
            {/* the gift on the PDF's last page → the facility platform (founder 2026-11-10) */}
            <p style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 16 }}>
              Plattform (Geschenk auf der letzten PDF-Seite): <b style={{ color: "var(--w)", fontWeight: 600 }}>{n(t.platformOpen)}</b> Link geöffnet · <b style={{ color: "var(--w)", fontWeight: 600 }}>{n(t.platformSignup)}</b> Zugang eröffnet ({pct(n(t.platformSignup), n(t.platformOpen))})
            </p>
            {/* visitors per day */}
            <div aria-label="Besucher pro Tag" className="bvt-chart" style={{ display: "flex", alignItems: "flex-end", gap: barGap, marginTop: 14, overflow: "hidden" }}>
              {daily.map((d) => (
                <div key={s(d.d)} title={`${s(d.d)}: ${n(d.visitors)} Besucher, ${n(d.submits)} Anfragen, ${n(d.bookings)} Buchungen`}
                  style={{ flex: 1, minWidth: 0, height: `${Math.max(4, (100 * n(d.visitors)) / maxDay)}%`, background: n(d.bookings) ? STATUS_DOT.approved : n(d.submits) ? STATUS_DOT.pending : STATUS_DOT.missing, borderRadius: 3 }} />
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontSize: 11.5, color: "var(--w3)", marginTop: 8 }}>
              <span className="bvt-hide-sm">Balken = Besucher pro Tag</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Dot st="pending" size={7} />mit Anfrage</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Dot st="approved" size={7} />mit Buchung</span>
              <span className="bvt-show-sm">% = vom Schritt davor</span>
            </div>
          </Card>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--w3)", margin: "10px 2px 0" }}>
            Besucher, Seiten, Quiz und Felder zählen nur, wer im Datenschutz-Hinweis zugestimmt hat ({n(t.consents)} Zustimmungen).
            Link-Klicks, Anfragen, Bestätigungen, PDF und Buchungen zählen immer alle.
          </p>
        </>
      )}

      {/* tracked links */}
      {view === "links" && (
        <>
          {caption("Ihre Links (für jeden Post, jedes Video, jede Mail einen)")}
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <form onSubmit={makeLink} className="bvt-form">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. LinkedIn-Post 12.11. Pflegeheime"
                className="bvk-input bvt-name" maxLength={120} />
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="bvk-input">
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="bvk-input">
                {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Btn kind="primary" type="submit"><Link2 size={14} /> Link erstellen</Btn>
            </form>
            {made && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10, padding: "9px 14px", borderRadius: 12, background: STATUS_TINT.approved, fontSize: 13, color: "var(--w)" }}>
                <span style={{ overflowWrap: "anywhere" }}>Neu: <b style={{ fontWeight: 600 }}>{made}</b></span>
                <Btn kind="quiet" size="sm" onClick={() => copy(made)} style={{ color: "var(--w)" }}>
                  {copied === made ? <Check size={13} /> : <Copy size={13} />} kopieren
                </Btn>
              </div>
            )}
          </Card>
          <Rows per={7} perPhone={2} main={0} empty="Noch keine Links. Erstellen Sie oben den ersten."
            cols={[{ label: "Name", wrap: true }, { label: "Link" }, { label: "Kanal" }, { label: "Ziel" }, { label: "Klicks", num: true }, { label: "Besucher", num: true }, { label: "Anfragen", num: true }, { label: "" }]}
            rows={(data?.links ?? []).map((l) => {
              const url = `https://borivon.com/l/${s(l.code)}`;
              return {
                key: s(l.code), dim: !!n(l.archived),
                cells: [
                  s(l.name),
                  <button key="c" type="button" onClick={() => copy(url)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: 0, padding: 0, color: "var(--w)", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                    {copied === url ? <Check size={12} /> : <Copy size={12} style={{ color: "var(--gold)" }} />} /l/{s(l.code)}
                  </button>,
                  CHANNELS.find(([v]) => v === s(l.channel))?.[1] ?? s(l.channel),
                  TARGETS.find(([v]) => v === s(l.target))?.[1] ?? s(l.target),
                  n(l.clicks), n(l.visitors), n(l.submits),
                  <Btn key="a" kind="quiet" size="sm" onClick={() => archive(s(l.code), !n(l.archived))} style={{ fontSize: 12.5 }}>
                    {n(l.archived) ? "wieder zeigen" : "ausblenden"}
                  </Btn>,
                ],
              };
            })} />
        </>
      )}

      {/* sources */}
      {view === "quellen" && (
        <>
          {caption("Woher sie kommen")}
          <Rows per={10} perPhone={5} main={0} empty="Noch keine Daten."
            cols={[{ label: "Quelle" }, { label: "Klicks", num: true }, { label: "Besucher", num: true }, { label: "Quiz begonnen", num: true }, { label: "Anfragen", num: true }, { label: "Buchungen", num: true }, { label: "Ø Zeit auf Seite", num: true, ph: "pre" }]}
            rows={(data?.sources ?? []).map((r) => ({
              key: s(r.source),
              cells: [s(r.source), n(r.clicks), n(r.visitors), n(r.quiz), n(r.submits), n(r.bookings), r.avgSec != null ? `${n(r.avgSec)} s` : "–"],
            }))} />
          <p style={{ fontSize: 11.5, color: "var(--w3)", margin: "10px 2px 0" }}>pdf = aus dem Fahrplan-PDF · mail = aus den E-Mails · ein Code (z. B. li-abc) = Ihr Link · sonst die Seite, von der sie kamen</p>
        </>
      )}

      {/* quiz drop-off */}
      {view === "quiz" && (
        <>
          {caption("Fahrplan-Quiz: wo sie aussteigen")}
          <Card style={{ padding: "16px 20px" }}>
            {(data?.quiz ?? []).length ? (
              <Paged items={data?.quiz ?? []} per={14} perPhone={6}>
                {(slice) => (
                  <div className="bvt-two-col">
                    {slice.map((q) => (
                      <div key={s(q.q)} style={{ breakInside: "avoid", paddingBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: "var(--w2)", marginBottom: 4 }}>
                          <span>{Q_LABEL[s(q.q)] ?? s(q.q)}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{n(q.reached)} · {pct(n(q.reached), quizTop)}</span>
                        </div>
                        <Bar w={(100 * n(q.reached)) / quizTop} />
                      </div>
                    ))}
                  </div>
                )}
              </Paged>
            ) : <p style={{ fontSize: 13, color: "var(--w3)" }}>Noch keine Daten.</p>}
          </Card>
          {(data?.fields ?? []).length > 0 && (
            <>
              <div style={{ fontSize: 12.5, color: "var(--w3)", margin: "14px 0 8px 2px" }}>Kontaktfelder (nur ob angeklickt und ausgefüllt, nie der Inhalt)</div>
              <Card style={{ padding: "4px 20px" }}>
                {(data?.fields ?? []).map((f, i) => (
                  <div key={s(f.field)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", fontSize: 13, color: "var(--w)", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <span>{F_LABEL[s(f.field)] ?? s(f.field)}</span><span style={{ color: "var(--w3)", fontVariantNumeric: "tabular-nums" }}>{n(f.entered)} angeklickt · {n(f.filled)} ausgefüllt</span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {/* who they are: quiz answers */}
      {view === "antworten" && (
        <>
          {caption("Wer kommt: Antworten im Quiz")}
          <Card style={{ padding: "16px 20px" }}>
            {Object.keys(answerGroups).length ? (
              <Paged items={Object.entries(answerGroups)} per={8} perPhone={4}>
                {(slice) => (
                  <div className="bvt-two-col">
                    {slice.map(([q, list]) => (
                      <div key={q} style={{ breakInside: "avoid", paddingBottom: 14 }}>
                        <div style={{ fontSize: 12.5, color: "var(--w3)", marginBottom: 6 }}>{Q_LABEL[q] ?? q}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {list.slice(0, 8).map((a) => (
                            <span key={s(a.v)} style={{ fontSize: 12.5, padding: "5px 11px", borderRadius: 999, background: "var(--bg2)", color: "var(--w)" }}>
                              {s(a.v) || "–"} <b style={{ fontWeight: 600 }}>{n(a.n)}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Paged>
            ) : <p style={{ fontSize: 13, color: "var(--w3)" }}>Noch keine Daten.</p>}
          </Card>
        </>
      )}

      {/* every Fahrplan lead, and how far they got */}
      {view === "anfragen" && (
        <>
          {caption("Fahrplan-Anfragen: wie weit jede gekommen ist")}
          <Rows per={7} perPhone={4} main={1} empty="Keine Anfragen in diesem Zeitraum."
            cols={[{ label: "Wann" }, { label: "Wer", wrap: true }, { label: "Quelle", ph: "pre" }, { label: "Stufe", ph: "pre" }, { label: "Bestätigt", ph: "pre" }, { label: "PDF", ph: "pre" }, { label: "Workshop", ph: "pre" }, { label: "Gebucht", ph: "pre" }, { label: "IP", ph: "pre" }]}
            rows={(data?.leads ?? []).map((l) => ({
              key: s(l.id),
              cells: [
                when(l.createdAt),
                <span key="w">{s(l.name)}<span style={{ display: "block", color: "var(--w3)", fontSize: 12, fontWeight: 400 }}>{s(l.email)}{l.facility ? ` · ${s(l.facility)}` : ""}</span></span>,
                s(l.src) || s(l.ref) || "–",
                s(l.level) || "–",
                yes(!!l.confirmedAt),
                yes(!!n(l.pdf), n(l.pdf) ? `${n(l.pdf)}×` : undefined),
                yes(!!n(l.workshop)),
                yes(!!n(l.booked)),
                s(l.ip),
              ],
            }))} />
        </>
      )}

      {/* recent visits */}
      {view === "besuche" && (
        <>
          {caption("Letzte Besuche")}
          <Rows per={7} perPhone={3} main={0} empty="Noch keine Besuche erfasst."
            cols={[{ label: "Wann" }, { label: "Quelle" }, { label: "Ort" }, { label: "Netzwerk", wrap: true }, { label: "Gerät", wrap: true }, { label: "IP (gekürzt)", ph: "pre" }, { label: "Seiten", wrap: true }, { label: "Gelesen", num: true }, { label: "Dauer", num: true, ph: "plain" }, { label: "Ergebnis" }]}
            rows={(data?.visits ?? []).map((v) => ({
              key: s(v.sid),
              cells: [
                when(v.start),
                s(v.src) || s(v.ref) || "direkt",
                [s(v.city), s(v.country)].filter(Boolean).join(", "),
                s(v.org),
                [s(v.device), s(v.os), s(v.browser)].filter(Boolean).join(" · "),
                s(v.ip),
                s(v.paths).split(",").join(" → "),
                v.scroll != null ? `${n(v.scroll)} %` : "–",
                n(v.ms) ? `${Math.round(n(v.ms) / 1000)} s` : "–",
                n(v.booked) ? "gebucht" : n(v.submitted) ? "angefragt" : n(v.answers) ? `${n(v.answers)} Antworten` : "",
              ],
            }))} />
          <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--w3)", margin: "10px 2px 0" }}>
            Erfasst ohne Cookies und ohne Speicherung auf dem Gerät. IPs gekürzt, Formularinhalte nie (nur ob ein Feld ausgefüllt wurde).
            Volle IP und Name nur bei Anfragen (Einwilligung). Netzwerk = Firma/Anbieter hinter der IP, z. B. ein Klinikverbund.
          </p>
        </>
      )}
    </main>
  );
}

/** a thin magnitude bar in the one look */
function Bar({ w }: { w: number }) {
  return (
    <div style={{ height: 6, background: "var(--bg2)", borderRadius: 999 }}>
      <div style={{ height: 6, width: `${w}%`, background: "var(--w2)", borderRadius: 999 }} />
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}

/** ph = how the cell reads on the phone line: value only ("plain"), "label value" ("pre") or "value label" ("post") */
type Col = { label: string; num?: boolean; wrap?: boolean; ph?: "plain" | "pre" | "post" };
type RowT = { key: string; cells: React.ReactNode[]; dim?: boolean };
/** a table on the laptop, two quiet lines per row on the phone; both flip page by page */
function Rows({ cols, rows, per, perPhone, main, empty }: { cols: Col[]; rows: RowT[]; per: number; perPhone: number; main: number; empty: string }) {
  const { slice, page, pages, setPage, narrow } = usePaged(rows, per, perPhone);
  const blank = (c: React.ReactNode) => c === "" || c == null;
  return (
    <>
      <Card style={{ padding: narrow ? "2px 16px" : "10px 12px 4px" }}>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--w3)", padding: "12px 4px" }}>{empty}</p>
        ) : narrow ? (
          slice.map((r, i) => {
            const bits = cols.map((c, j) => {
              if (j === main || blank(r.cells[j])) return null;
              const mode = c.ph ?? (c.num ? "post" : "plain");
              const v = <span style={{ color: "var(--w2)" }}>{r.cells[j]}</span>;
              return mode === "plain" || !c.label ? v : mode === "pre" ? <>{c.label} {v}</> : <>{v} {c.label}</>;
            }).filter(Boolean);
            return (
              <div key={r.key} style={{ padding: "11px 0", borderTop: i ? "1px solid var(--border)" : "none", opacity: r.dim ? 0.45 : 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", overflowWrap: "anywhere" }}>{r.cells[main]}</div>
                <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.6, color: "var(--w3)", overflowWrap: "anywhere" }}>
                  {bits.map((b, k) => <span key={k}>{k ? <span aria-hidden="true"> · </span> : null}{b}</span>)}
                </div>
              </div>
            );
          })
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{cols.map((c, j) => (
                <th key={j} style={{ textAlign: c.num ? "right" : "left", fontWeight: 500, fontSize: 12, color: "var(--w3)", padding: "2px 8px 8px", whiteSpace: "nowrap", textTransform: "none", letterSpacing: "normal" }}>{c.label}</th>
              ))}</tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.key} style={{ opacity: r.dim ? 0.45 : 1 }}>
                  {r.cells.map((cell, j) => (
                    <td key={j} style={{ padding: "9px 8px", fontSize: 13, color: "var(--w)", borderTop: "1px solid var(--border)", verticalAlign: "top", whiteSpace: cols[j]?.wrap ? "normal" : "nowrap",
                      textAlign: cols[j]?.num ? "right" : "left", fontVariantNumeric: cols[j]?.num ? "tabular-nums" : undefined, fontWeight: j === main ? 500 : 400 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}
