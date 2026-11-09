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
import { ArrowLeft, Copy, Check, Link2, EyeOff, Eye } from "lucide-react";

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

const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, padding: 18 };
const th: React.CSSProperties = { textAlign: "left", fontWeight: 500, color: "var(--w3)", fontSize: 12, padding: "6px 8px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 8px", fontSize: 13, color: "var(--w)", borderTop: "1px solid var(--border)", verticalAlign: "top" };

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[15px] font-medium mb-3" style={{ color: "var(--w)" }}>{children}</h2>;
}

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

  return (
    <main className="mx-auto px-4 pt-[96px] pb-20" style={{ maxWidth: 1180 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => router.push("/portal/admin")} aria-label="Zurück" className="bv-tap" style={{ color: "var(--w2)" }}>
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-[22px] font-medium" style={{ color: "var(--w)" }}>Besucher &amp; Quellen</h1>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className="text-[12px] px-3 py-1.5"
              style={{ borderRadius: 999, border: "1px solid var(--border)", background: days === d ? "var(--gold)" : "transparent", color: days === d ? "#131312" : "var(--w2)", fontWeight: days === d ? 600 : 400 }}>
              {d === 365 ? "1 Jahr" : `${d} Tage`}
            </button>
          ))}
          <button type="button" onClick={toggleMine} title="Ihre eigenen Besuche nicht mitzählen (nur dieser Browser)"
            className="text-[12px] px-3 py-1.5 flex items-center gap-1.5" style={{ borderRadius: 999, border: "1px solid var(--border)", color: "var(--w3)" }}>
            {mine ? <EyeOff size={13} /> : <Eye size={13} />} {mine ? "Dieser Browser zählt nicht" : "Mich nicht zählen"}
          </button>
        </div>
      </div>

      {data?.errors?.length ? <p className="text-[12px] mb-4" style={{ color: "#ef4444" }}>Teilweise nicht geladen: {data.errors.join(" · ")}</p> : null}

      {/* the whole funnel, step by step */}
      <section style={card} className="mb-4">
        <H>Der Weg: vom Klick bis zur Buchung</H>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {funnel.map(([label, v], i) => (
            <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "12px 14px" }}>
              <div className="text-[12px]" style={{ color: "var(--w3)" }}>{label}</div>
              <div className="text-[24px] font-medium" style={{ color: "var(--w)" }}>{v}</div>
              {i > 0 && <div className="text-[11px]" style={{ color: "var(--w3)" }}>{pct(v, funnel[i - 1][1])} vom Schritt davor</div>}
            </div>
          ))}
        </div>
        {/* visitors per day */}
        <div className="flex items-end gap-[3px] mt-5" style={{ height: 80 }} aria-label="Besucher pro Tag">
          {(data?.daily ?? []).map((d) => (
            <div key={s(d.d)} title={`${s(d.d)}: ${n(d.visitors)} Besucher, ${n(d.submits)} Anfragen, ${n(d.bookings)} Buchungen`}
              style={{ flex: 1, minWidth: 3, height: `${Math.max(3, (80 * n(d.visitors)) / maxDay)}px`, background: n(d.bookings) ? "#16a34a" : n(d.submits) ? "var(--gold)" : "var(--border-gold, #c9a24066)", borderRadius: 3 }} />
          ))}
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--w3)" }}>Balken = Besucher pro Tag · gold = mit Anfrage · grün = mit Buchung</p>
        <p className="text-[12px] mt-2" style={{ color: "var(--w2)" }}>
          Besucher, Seiten, Quiz und Felder zählen nur, wer im Datenschutz-Hinweis zugestimmt hat ({n(t.consents)} Zustimmungen).
          Link-Klicks, Anfragen, Bestätigungen, PDF und Buchungen zählen immer alle.
        </p>
      </section>

      {/* tracked links */}
      <section style={card} className="mb-4">
        <H>Ihre Links (für jeden Post, jedes Video, jede Mail einen)</H>
        <form onSubmit={makeLink} className="flex flex-wrap gap-2 mb-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. LinkedIn-Post 12.11. Pflegeheime"
            className="bv-input flex-1" style={{ minWidth: 220 }} maxLength={120} />
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="bv-input" style={{ width: 150 }}>
            {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="bv-input" style={{ width: 200 }}>
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="submit" className="bv-btn bv-btn-primary" style={{ background: "var(--gold)", color: "#131312" }}>
            <Link2 size={14} /> Link erstellen
          </button>
        </form>
        {made && (
          <p className="text-[13px] mb-3 flex items-center gap-2" style={{ color: "var(--w)" }}>
            Neu: <b>{made}</b>
            <button type="button" onClick={() => copy(made)} className="flex items-center gap-1 text-[12px]" style={{ color: "var(--gold)" }}>
              {copied === made ? <Check size={13} /> : <Copy size={13} />} kopieren
            </button>
          </p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Link</th><th style={th}>Kanal</th><th style={th}>Ziel</th><th style={th}>Klicks</th><th style={th}>Besucher</th><th style={th}>Anfragen</th><th style={th} /></tr></thead>
            <tbody>
              {(data?.links ?? []).map((l) => {
                const url = `https://borivon.com/l/${s(l.code)}`;
                return (
                  <tr key={s(l.code)} style={{ opacity: n(l.archived) ? 0.45 : 1 }}>
                    <td style={td}>{s(l.name)}</td>
                    <td style={td}>
                      <button type="button" onClick={() => copy(url)} className="flex items-center gap-1" style={{ color: "var(--gold)" }}>
                        {copied === url ? <Check size={12} /> : <Copy size={12} />} /l/{s(l.code)}
                      </button>
                    </td>
                    <td style={td}>{CHANNELS.find(([v]) => v === s(l.channel))?.[1] ?? s(l.channel)}</td>
                    <td style={td}>{TARGETS.find(([v]) => v === s(l.target))?.[1] ?? s(l.target)}</td>
                    <td style={td}>{n(l.clicks)}</td><td style={td}>{n(l.visitors)}</td><td style={td}>{n(l.submits)}</td>
                    <td style={td}>
                      <button type="button" onClick={() => archive(s(l.code), !n(l.archived))} className="text-[12px]" style={{ color: "var(--w3)" }}>
                        {n(l.archived) ? "wieder zeigen" : "ausblenden"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!(data?.links ?? []).length && <tr><td style={td} colSpan={8}>Noch keine Links. Erstellen Sie oben den ersten.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* sources */}
      <section style={card} className="mb-4">
        <H>Woher sie kommen</H>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Quelle</th><th style={th}>Klicks</th><th style={th}>Besucher</th><th style={th}>Quiz begonnen</th><th style={th}>Anfragen</th><th style={th}>Buchungen</th><th style={th}>Ø Zeit auf Seite</th></tr></thead>
            <tbody>
              {(data?.sources ?? []).map((r) => (
                <tr key={s(r.source)}>
                  <td style={td}>{s(r.source)}</td><td style={td}>{n(r.clicks)}</td><td style={td}>{n(r.visitors)}</td>
                  <td style={td}>{n(r.quiz)}</td><td style={td}>{n(r.submits)}</td><td style={td}>{n(r.bookings)}</td>
                  <td style={td}>{r.avgSec != null ? `${n(r.avgSec)} s` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--w3)" }}>pdf = aus dem Fahrplan-PDF · mail = aus den E-Mails · ein Code (z. B. li-abc) = Ihr Link · sonst die Seite, von der sie kamen</p>
      </section>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        {/* quiz drop-off */}
        <section style={card}>
          <H>Fahrplan-Quiz: wo sie aussteigen</H>
          {(data?.quiz ?? []).map((q) => (
            <div key={s(q.q)} className="mb-2">
              <div className="flex justify-between text-[12.5px]" style={{ color: "var(--w2)" }}>
                <span>{Q_LABEL[s(q.q)] ?? s(q.q)}</span><span>{n(q.reached)} · {pct(n(q.reached), quizTop)}</span>
              </div>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
                <div style={{ height: 6, width: `${(100 * n(q.reached)) / quizTop}%`, background: "var(--gold)", borderRadius: 3 }} />
              </div>
            </div>
          ))}
          {!(data?.quiz ?? []).length && <p className="text-[13px]" style={{ color: "var(--w3)" }}>Noch keine Daten.</p>}
          {(data?.fields ?? []).length > 0 && (
            <>
              <p className="text-[12px] mt-4 mb-1" style={{ color: "var(--w3)" }}>Kontaktfelder (nur ob angeklickt und ausgefüllt, nie der Inhalt)</p>
              {(data?.fields ?? []).map((f) => (
                <div key={s(f.field)} className="flex justify-between text-[12.5px]" style={{ color: "var(--w2)" }}>
                  <span>{F_LABEL[s(f.field)] ?? s(f.field)}</span><span>{n(f.entered)} angeklickt · {n(f.filled)} ausgefüllt</span>
                </div>
              ))}
            </>
          )}
        </section>

        {/* who they are: quiz answers */}
        <section style={card}>
          <H>Wer kommt: Antworten im Quiz</H>
          {Object.entries(answerGroups).map(([q, list]) => (
            <div key={q} className="mb-3">
              <div className="text-[12px] mb-1" style={{ color: "var(--w3)" }}>{Q_LABEL[q] ?? q}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.slice(0, 8).map((a) => (
                  <span key={s(a.v)} className="text-[12px] px-2 py-0.5" style={{ borderRadius: 999, border: "1px solid var(--border)", color: "var(--w2)" }}>
                    {s(a.v) || "–"} · {n(a.n)}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {!Object.keys(answerGroups).length && <p className="text-[13px]" style={{ color: "var(--w3)" }}>Noch keine Daten.</p>}
        </section>
      </div>

      {/* every Fahrplan lead, and how far they got */}
      <section style={card} className="mb-4">
        <H>Fahrplan-Anfragen: wie weit jede gekommen ist</H>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Wann</th><th style={th}>Wer</th><th style={th}>Quelle</th><th style={th}>Stufe</th><th style={th}>Bestätigt</th><th style={th}>PDF</th><th style={th}>Workshop</th><th style={th}>Gebucht</th><th style={th}>IP</th></tr></thead>
            <tbody>
              {(data?.leads ?? []).map((l) => (
                <tr key={s(l.id)}>
                  <td style={td}>{when(l.createdAt)}</td>
                  <td style={td}>{s(l.name)}<div style={{ color: "var(--w3)", fontSize: 12 }}>{s(l.email)}{l.facility ? ` · ${s(l.facility)}` : ""}</div></td>
                  <td style={td}>{s(l.src) || s(l.ref) || "–"}</td>
                  <td style={td}>{s(l.level) || "–"}</td>
                  <td style={td}>{l.confirmedAt ? "✓" : "–"}</td>
                  <td style={td}>{n(l.pdf) ? `✓ ${n(l.pdf)}×` : "–"}</td>
                  <td style={td}>{n(l.workshop) ? "✓" : "–"}</td>
                  <td style={td}>{n(l.booked) ? "✓" : "–"}</td>
                  <td style={td}>{s(l.ip)}</td>
                </tr>
              ))}
              {!(data?.leads ?? []).length && <tr><td style={td} colSpan={9}>Keine Anfragen in diesem Zeitraum.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* recent visits */}
      <section style={card}>
        <H>Letzte Besuche</H>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Wann</th><th style={th}>Quelle</th><th style={th}>Ort</th><th style={th}>Netzwerk</th><th style={th}>Gerät</th><th style={th}>IP (gekürzt)</th><th style={th}>Seiten</th><th style={th}>Gelesen</th><th style={th}>Dauer</th><th style={th}>Ergebnis</th></tr></thead>
            <tbody>
              {(data?.visits ?? []).map((v) => (
                <tr key={s(v.sid)}>
                  <td style={td}>{when(v.start)}</td>
                  <td style={td}>{s(v.src) || s(v.ref) || "direkt"}</td>
                  <td style={td}>{[s(v.city), s(v.country)].filter(Boolean).join(", ")}</td>
                  <td style={td}>{s(v.org)}</td>
                  <td style={td}>{[s(v.device), s(v.os), s(v.browser)].filter(Boolean).join(" · ")}</td>
                  <td style={td}>{s(v.ip)}</td>
                  <td style={td}>{s(v.paths).split(",").join(" → ")}</td>
                  <td style={td}>{v.scroll != null ? `${n(v.scroll)} %` : "–"}</td>
                  <td style={td}>{n(v.ms) ? `${Math.round(n(v.ms) / 1000)} s` : "–"}</td>
                  <td style={td}>{n(v.booked) ? "gebucht" : n(v.submitted) ? "angefragt" : n(v.answers) ? `${n(v.answers)} Antworten` : ""}</td>
                </tr>
              ))}
              {!(data?.visits ?? []).length && <tr><td style={td} colSpan={10}>Noch keine Besuche erfasst.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] mt-3" style={{ color: "var(--w3)" }}>
          Erfasst ohne Cookies und ohne Speicherung auf dem Gerät. IPs gekürzt, Formularinhalte nie (nur ob ein Feld ausgefüllt wurde).
          Volle IP und Name nur bei Anfragen (Einwilligung). Netzwerk = Firma/Anbieter hinter der IP, z. B. ein Klinikverbund.
        </p>
      </section>
    </main>
  );
}
