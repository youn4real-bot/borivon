"use client";

/**
 * /portal/admin/bookings — every call in one place.
 *
 * Two jobs:
 *  1. See what's coming, and record what happened afterwards. An untracked
 *     call is a lost one; the outcome field is what the follow-ups feed on.
 *  2. ADD SOMEONE BY HAND. Most people never touch the booking page — they
 *     agree a time on WhatsApp or during a call. Those still have to be in
 *     the system, or the follow-up chain never starts for them.
 *
 * Status is colour-only per LAW #4 — the dot carries the meaning, the text
 * next to it is the person's name, never a status word.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal } from "@/components/ui/Modal";
import { QUESTIONS, type Selections } from "@/lib/booking";
import {
  ArrowLeft, Plus, Video, Phone, Mail, Loader2, Check, X, CalendarDays, Building2,
  SlidersHorizontal, Link2, UserPlus, UserCheck,
} from "lucide-react";

type Kind = "nurse" | "clinic" | "company";
type Status = "booked" | "held" | "no_show" | "cancelled";

type Booking = {
  id: number; kind: Kind; name: string; email: string | null; phone: string | null;
  company: string | null; note: string | null; selections: Selections | null;
  starts_at: string; ends_at: string; meet_link: string | null;
  status: Status; outcome: string | null; source: "public" | "admin"; created_at: string;
  /** Set once this booking's person has been made a Pool candidate. */
  pooled_user_id?: string | null;
};

const KIND_LABEL: Record<Kind, { en: string; de: string; fr: string }> = {
  nurse:   { en: "Nurse",   de: "Pflegekraft",  fr: "Infirmier·ère" },
  clinic:  { en: "Clinic",  de: "Einrichtung",  fr: "Établissement" },
  company: { en: "Company", de: "Unternehmen",  fr: "Entreprise" },
};

// LAW #4 — colour carries the status, never a text label.
const STATUS_COLOR: Record<Status, string> = {
  booked:    "#f59e0b", // upcoming / not yet resolved
  held:      "#16a34a", // it happened
  no_show:   "#ef4444", // they didn't turn up
  cancelled: "var(--w3)",
};

export default function AdminBookingsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = useCallback((en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en), [lang]);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Booking[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [poolErr, setPoolErr] = useState<string | null>(null);

  const load = useCallback(async (tk: string) => {
    const r = await fetch("/api/portal/admin/bookings", { headers: { Authorization: `Bearer ${tk}` }, cache: "no-store" });
    if (r.status === 401 || r.status === 403) { router.replace("/portal/admin"); return; }
    const j = await r.json().catch(() => ({ bookings: [] }));
    setRows((j.bookings ?? []) as Booking[]);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep token */ }
      }
      if (cancelled) return;
      setToken(tk);
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  // JWTs refresh every ~55 min — without this every action after an hour 401s.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (s?.access_token) setToken(s.access_token); });
    return () => data.subscription.unsubscribe();
  }, []);

  // Three buckets, not two. A cancelled call that is still in the FUTURE is
  // neither upcoming nor past — filing it under "Past" put a future date under
  // a heading that says it already happened.
  const { upcoming, cancelled, past } = useMemo(() => {
    const now = Date.now();
    const future = (b: Booking) => Date.parse(b.starts_at) >= now;
    const byStart = (a: Booking, b: Booking) => Date.parse(a.starts_at) - Date.parse(b.starts_at);
    return {
      upcoming: rows.filter((b) => future(b) && b.status !== "cancelled").sort(byStart),
      cancelled: rows.filter((b) => future(b) && b.status === "cancelled").sort(byStart),
      past: rows.filter((b) => !future(b)).sort((a, b) => byStart(b, a)),
    };
  }, [rows]);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const r = await fetch("/api/portal/admin/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, ...body }),
      });
      if (r.ok) await load(token);
    } finally {
      setBusyId(null);
    }
  }

  /** Turn a nurse booking into a Pool candidate — the same bridge the Leads
   *  page uses, so a booked call and a WhatsApp lead end up in one place. */
  async function pool(id: number) {
    setBusyId(id);
    setPoolErr(null);
    try {
      const r = await fetch("/api/portal/admin/lead-to-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingId: id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPoolErr(j?.error === "no_email"
          ? T("This booking has no email, so no account can be created yet.",
              "Dieser Termin hat keine E-Mail — es kann noch kein Konto angelegt werden.",
              "Ce rendez-vous n'a pas d'e-mail — aucun compte ne peut être créé.")
          : j?.error === "Supreme admin only"
            ? T("Only the main admin can do this.", "Nur der Hauptadmin kann das.", "Seul l'administrateur principal peut le faire.")
            : T("Couldn't add to the pool.", "Konnte nicht zum Pool hinzugefügt werden.", "Impossible d'ajouter au vivier."));
        return;
      }
      await load(token);
    } catch {
      setPoolErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <PageLoader />;

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB",
        { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 920 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="flex items-start justify-between gap-4 mb-7 flex-wrap">
        <div>
          <h1 className="bv-h1">{T("Bookings", "Termine", "Rendez-vous")}</h1>
          <p className="bv-body mt-1">
            {upcoming.length} {T("upcoming", "anstehend", "à venir")} · {rows.length} {T("total", "gesamt", "au total")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setAvailOpen(true)} className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-2">
            <SlidersHorizontal size={15} strokeWidth={2} /> {T("My availability", "Meine Zeiten", "Mes disponibilités")}
          </button>
          <button onClick={() => setAddOpen(true)} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
            <Plus size={15} strokeWidth={2} /> {T("Add by hand", "Manuell eintragen", "Ajouter manuellement")}
          </button>
        </div>
      </div>

      {poolErr && (
        <p className="text-[13px] mb-4" style={{ color: "#ef4444" }} role="alert">{poolErr}</p>
      )}

      {!rows.length ? (
        <div className="bv-card p-8 text-center" style={{ borderRadius: 18 }}>
          <CalendarDays size={22} style={{ color: "var(--w3)" }} className="mx-auto mb-3" />
          <p className="bv-body">
            {T("No bookings yet. They'll appear here as soon as someone books at /book — or add one by hand.",
               "Noch keine Termine. Sie erscheinen hier, sobald jemand unter /book bucht — oder tragen Sie einen manuell ein.",
               "Aucun rendez-vous. Ils apparaîtront ici dès qu'une réservation est faite sur /book — ou ajoutez-en un manuellement.")}
          </p>
        </div>
      ) : (
        <>
          {!!upcoming.length && (
            <Section title={T("Upcoming", "Anstehend", "À venir")}>
              {upcoming.map((b) => (
                <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} onPool={pool} />
              ))}
            </Section>
          )}
          {!!cancelled.length && (
            <Section title={T("Cancelled", "Abgesagt", "Annulés")}>
              {cancelled.map((b) => (
                <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} onPool={pool} />
              ))}
            </Section>
          )}
          {!!past.length && (
            <Section title={T("Past", "Vergangen", "Passés")}>
              {past.map((b) => (
                <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} onPool={pool} />
              ))}
            </Section>
          )}
        </>
      )}

      {addOpen && (
        <AddBookingModal
          token={token}
          T={T}
          onClose={() => setAddOpen(false)}
          onSaved={async () => { setAddOpen(false); await load(token); }}
        />
      )}

      {availOpen && <AvailabilityModal token={token} T={T} onClose={() => setAvailOpen(false)} />}
    </main>
  );
}

/* ── My availability ──────────────────────────────────────────────────────────
 * Working hours, appointment length, buffer, notice, horizon and days off — the
 * things that were hardcoded in lib/booking.ts until now.
 * -------------------------------------------------------------------------- */

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0] as const; // Mon-first, the way a week reads
const DAY_NAME: Record<number, { en: string; de: string; fr: string }> = {
  1: { en: "Monday", de: "Montag", fr: "Lundi" },
  2: { en: "Tuesday", de: "Dienstag", fr: "Mardi" },
  3: { en: "Wednesday", de: "Mittwoch", fr: "Mercredi" },
  4: { en: "Thursday", de: "Donnerstag", fr: "Jeudi" },
  5: { en: "Friday", de: "Freitag", fr: "Vendredi" },
  6: { en: "Saturday", de: "Samstag", fr: "Samedi" },
  0: { en: "Sunday", de: "Sonntag", fr: "Dimanche" },
};

function AvailabilityModal({
  token, T, onClose,
}: {
  token: string;
  T: (en: string, de: string, fr: string) => string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [week, setWeek] = useState<Record<number, string>>({});   // day → "09:00-13:00, 14:00-18:00"
  const [slot, setSlot] = useState(30);
  const [buffer, setBuffer] = useState(0);
  const [notice, setNotice] = useState(12);
  const [horizon, setHorizon] = useState(14);
  const [accepting, setAccepting] = useState(true);
  const [blackout, setBlackout] = useState("");                   // one YYYY-MM-DD per line

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/portal/admin/booking-availability", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const a = j?.availability ?? {};
        const w: Record<number, string> = {};
        for (const [k, v] of Object.entries(a.week ?? {})) {
          if (Array.isArray(v)) w[Number(k)] = v.join(", ");
        }
        setWeek(w);
        setSlot(Number(a.slot_minutes) || 30);
        setBuffer(Number(a.buffer_minutes) || 0);
        setNotice(Number(a.min_notice_hours) ?? 12);
        setHorizon(Number(a.horizon_days) || 14);
        setAccepting(a.accepting !== false);
        setBlackout((Array.isArray(a.blackout_dates) ? a.blackout_dates : []).join("\n"));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const weekOut: Record<number, string[]> = {};
      for (const [k, raw] of Object.entries(week)) {
        const windows = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (windows.length) weekOut[Number(k)] = windows;
      }
      const r = await fetch("/api/portal/admin/booking-availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          week: weekOut, slot_minutes: slot, buffer_minutes: buffer,
          min_notice_hours: notice, horizon_days: horizon, accepting,
          blackout_dates: blackout.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error === "not_migrated"
          ? T("Run supabase/booking_maxx.sql first.", "Bitte zuerst supabase/booking_maxx.sql ausführen.", "Exécutez d'abord supabase/booking_maxx.sql.")
          : j?.error === "bad_week"
            ? T("Check the hours — each one must look like 09:00-13:00.",
                "Zeiten prüfen — jede muss wie 09:00-13:00 aussehen.",
                "Vérifiez les horaires — chacun doit ressembler à 09:00-13:00.")
            : T("Couldn't save.", "Konnte nicht gespeichert werden.", "Échec de l'enregistrement."));
        return;
      }
      setSaved(true);
    } catch {
      setErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally {
      setSaving(false);
    }
  }

  const dayName = (d: number) => T(DAY_NAME[d].en, DAY_NAME[d].de, DAY_NAME[d].fr);

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title={T("My availability", "Meine Zeiten", "Mes disponibilités")}
      footer={
        <>
          <button onClick={onClose} disabled={saving} className="bv-btn bv-btn-ghost bv-tap">
            {T("Close", "Schließen", "Fermer")}
          </button>
          <button onClick={save} disabled={saving || loading} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {T("Save", "Speichern", "Enregistrer")}
          </button>
        </>
      }
    >
      <div className="grid gap-4 px-5 py-4">
        {loading ? (
          <div className="bv-skeleton" style={{ height: 260, borderRadius: 14 }} aria-busy="true" />
        ) : (
          <>
            <label className="flex items-center gap-2.5 text-[13.5px] bv-tap" style={{ color: "var(--w2)" }}>
              <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
              {T("Accepting bookings", "Termine annehmen", "Accepter les réservations")}
            </label>
            {!accepting && (
              <p className="text-[12.5px] -mt-2" style={{ color: "var(--w3)" }}>
                {T("/book will show no times and invite people to email instead. Nothing is deleted.",
                   "/book zeigt keine Zeiten und bittet um eine E-Mail. Es wird nichts gelöscht.",
                   "/book n'affichera aucun créneau et invitera à écrire. Rien n'est supprimé.")}
              </p>
            )}

            <div>
              <p className="bv-label mb-2">{T("Working hours", "Arbeitszeiten", "Heures de travail")}</p>
              <div className="grid gap-2">
                {DAY_KEYS.map((d) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-[12.5px] flex-shrink-0" style={{ color: "var(--w3)", width: 84 }}>{dayName(d)}</span>
                    <input
                      className="bv-input flex-1"
                      value={week[d] ?? ""}
                      placeholder={T("closed", "geschlossen", "fermé")}
                      onChange={(e) => setWeek((w) => ({ ...w, [d]: e.target.value }))}
                      aria-label={dayName(d)}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[12px] mt-2" style={{ color: "var(--w3)" }}>
                {T("Comma-separated, e.g. 09:00-13:00, 14:00-18:00. Leave a day empty to close it.",
                   "Kommagetrennt, z. B. 09:00-13:00, 14:00-18:00. Leer lassen = geschlossen.",
                   "Séparés par des virgules, ex. 09:00-13:00, 14:00-18:00. Laissez vide pour fermer.")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="bv-label" htmlFor="av-slot">{T("Appointment length", "Termindauer", "Durée du rendez-vous")}</label>
                <select id="av-slot" className="bv-input" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                  {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
              <div>
                <label className="bv-label" htmlFor="av-buffer">{T("Gap between calls", "Puffer zwischen Terminen", "Pause entre les appels")}</label>
                <select id="av-buffer" className="bv-input" value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>{m === 0 ? T("none", "keiner", "aucune") : `${m} min`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bv-label" htmlFor="av-notice">{T("Minimum notice", "Mindestvorlauf", "Préavis minimum")}</label>
                <select id="av-notice" className="bv-input" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
                  {[0, 2, 4, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>{h === 0 ? T("none", "keiner", "aucun") : `${h} h`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="bv-label" htmlFor="av-horizon">{T("Book up to", "Buchbar bis", "Réservable jusqu'à")}</label>
                <select id="av-horizon" className="bv-input" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                  {[7, 14, 21, 30, 60].map((d) => (
                    <option key={d} value={d}>{d} {T("days ahead", "Tage im Voraus", "jours à l'avance")}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="bv-label" htmlFor="av-blackout">{T("Days off", "Freie Tage", "Jours de congé")}</label>
              <textarea
                id="av-blackout" className="bv-input" rows={3} value={blackout}
                onChange={(e) => setBlackout(e.target.value)} style={{ resize: "vertical" }}
                placeholder="2026-08-15&#10;2026-12-25"
              />
              <p className="text-[12px] mt-1" style={{ color: "var(--w3)" }}>
                {T("One date per line (YYYY-MM-DD). Nothing is offered on these days.",
                   "Ein Datum pro Zeile (JJJJ-MM-TT). An diesen Tagen wird nichts angeboten.",
                   "Une date par ligne (AAAA-MM-JJ). Aucun créneau ces jours-là.")}
              </p>
            </div>

            <a href="/book" target="_blank" rel="noopener noreferrer" className="bv-link text-[13px] inline-flex items-center gap-2">
              <Link2 size={13} aria-hidden /> {T("Preview the booking page", "Buchungsseite ansehen", "Voir la page de réservation")}
            </a>

            {err && <p className="text-[13px]" style={{ color: "#ef4444" }} role="alert">{err}</p>}
            {saved && (
              <p className="text-[13px]" style={{ color: "#16a34a" }} role="status">
                {T("Saved — the booking page is live with these hours.",
                   "Gespeichert — die Buchungsseite nutzt diese Zeiten.",
                   "Enregistré — la page de réservation utilise ces horaires.")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <p className="bv-eyebrow mb-3">{title}</p>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Row({
  b, T, lang, fmt, busy, onPatch, onPool,
}: {
  b: Booking;
  T: (en: string, de: string, fr: string) => string;
  lang: string;
  fmt: (iso: string) => string;
  busy: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
  onPool: (id: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(b.outcome ?? "");
  const kl = KIND_LABEL[b.kind];
  const who = b.company || b.name;
  const past = Date.parse(b.starts_at) < Date.now();

  return (
    <div className="bv-card" style={{ borderRadius: 14, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-center gap-3 p-4 bv-row-hover bv-tap"
        aria-expanded={open}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[b.status], flexShrink: 0 }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-[14.5px] font-medium truncate" style={{ color: "var(--w)" }}>{who}</span>
            <span className="bv-chip">{lang === "de" ? kl.de : lang === "fr" ? kl.fr : kl.en}</span>
            {b.source === "admin" && (
              <span className="bv-chip" title={T("Added by hand", "Manuell eingetragen", "Ajouté manuellement")}>
                {T("manual", "manuell", "manuel")}
              </span>
            )}
          </span>
          <span className="block text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>{fmt(b.starts_at)}</span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 grid gap-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div className="grid gap-1.5 text-[13px]" style={{ color: "var(--w2)" }}>
            {b.company && <span className="flex items-center gap-2"><Building2 size={13} aria-hidden /> {b.name}</span>}
            {b.email && <a className="bv-link flex items-center gap-2" href={`mailto:${b.email}`}><Mail size={13} aria-hidden /> {b.email}</a>}
            {b.phone && <a className="bv-link flex items-center gap-2" href={`tel:${b.phone.replace(/\s/g, "")}`}><Phone size={13} aria-hidden /> {b.phone}</a>}
            {b.meet_link && (
              <a className="bv-link flex items-center gap-2" href={b.meet_link} target="_blank" rel="noopener noreferrer">
                <Video size={13} aria-hidden /> {T("Join video call", "Videoanruf beitreten", "Rejoindre la visio")}
              </a>
            )}
            {b.note && <span className="mt-1" style={{ color: "var(--w3)" }}>{b.note}</span>}
          </div>

          {/* What they ticked — the reason the form asks in taps instead of prose. */}
          {!!b.selections && Object.keys(b.selections).length > 0 && (
            <div className="grid gap-2">
              {(QUESTIONS[b.kind] ?? []).map((q) => {
                const ids = b.selections?.[q.id];
                if (!ids?.length) return null;
                const labels = ids
                  .map((id) => q.options.find((o) => o.id === id))
                  .filter((o): o is NonNullable<typeof o> => !!o)
                  .map((o) => (lang === "de" ? o.de : lang === "fr" ? o.fr : o.en));
                return (
                  <div key={q.id}>
                    <p className="text-[11px] uppercase mb-1" style={{ color: "var(--w3)", letterSpacing: ".06em" }}>
                      {lang === "de" ? q.de : lang === "fr" ? q.fr : q.en}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {labels.map((l) => <span key={l} className="bv-chip bv-chip-gold">{l}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* What happened — the field the follow-ups actually feed on. */}
          {past && (
            <div>
              <label className="bv-label" htmlFor={`out-${b.id}`}>
                {T("What came out of it?", "Was kam dabei heraus?", "Qu'en est-il ressorti ?")}
              </label>
              <textarea
                id={`out-${b.id}`} className="bv-input" rows={2} value={outcome} maxLength={2000}
                onChange={(e) => setOutcome(e.target.value)} style={{ resize: "vertical" }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {past && (
              <>
                <button
                  onClick={() => onPatch(b.id, { status: "held", outcome })}
                  disabled={busy}
                  className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-1.5 text-[13px]"
                  style={{ borderColor: b.status === "held" ? "#16a34a" : undefined }}
                >
                  <Check size={13} aria-hidden /> {T("It happened", "Hat stattgefunden", "A eu lieu")}
                </button>
                <button
                  onClick={() => onPatch(b.id, { status: "no_show", outcome })}
                  disabled={busy}
                  className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-1.5 text-[13px]"
                  style={{ borderColor: b.status === "no_show" ? "#ef4444" : undefined }}
                >
                  <X size={13} aria-hidden /> {T("No show", "Nicht erschienen", "Absent")}
                </button>
              </>
            )}
            {b.status !== "cancelled" && (
              <button
                onClick={() => onPatch(b.id, { status: "cancelled" })}
                disabled={busy}
                className="bv-btn bv-btn-ghost bv-tap text-[13px]"
                style={{ color: "var(--w3)" }}
              >
                {T("Cancel", "Absagen", "Annuler")}
              </button>
            )}
            {/* A nurse who books is exactly the person the Pool is for. Clinics
                and companies are counterparties, not candidates — no button. */}
            {b.kind === "nurse" && (
              b.pooled_user_id ? (
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#16a34a" }}>
                  <UserCheck size={13} aria-hidden /> {T("In the pool", "Im Pool", "Dans le vivier")}
                </span>
              ) : (
                <button
                  onClick={() => onPool(b.id)}
                  disabled={busy}
                  className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-1.5 text-[13px]"
                >
                  <UserPlus size={13} aria-hidden /> {T("Add to pool", "In den Pool", "Ajouter au vivier")}
                </button>
              )
            )}
            {busy && <Loader2 size={14} className="animate-spin" style={{ color: "var(--w3)" }} aria-hidden />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Manual scheduling — the WhatsApp/phone bookings that never touch /book. */
function AddBookingModal({
  token, T, onClose, onSaved,
}: {
  token: string;
  T: (en: string, de: string, fr: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("nurse");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");     // datetime-local, in the admin's own clock
  const [minutes, setMinutes] = useState(30);
  const [invite, setInvite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const at = Date.parse(when);
    if (name.trim().length < 2) { setErr(T("Enter a name.", "Namen eingeben.", "Indiquez un nom.")); return; }
    if (!Number.isFinite(at))   { setErr(T("Pick a date and time.", "Datum und Uhrzeit wählen.", "Choisissez une date et une heure.")); return; }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/portal/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, at, name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), note: note.trim(), minutes, invite }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error === "slot_taken"
          ? T("There's already a booking at that time.", "Zu dieser Zeit gibt es bereits einen Termin.", "Un rendez-vous existe déjà à cette heure.")
          : T("Couldn't save. Please try again.", "Konnte nicht gespeichert werden. Bitte erneut versuchen.", "Échec de l'enregistrement. Réessayez."));
        return;
      }
      await onSaved();
    } catch {
      setErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally {
      setSaving(false);
    }
  }

  const isOrg = kind === "clinic" || kind === "company";

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title={T("Add a booking", "Termin eintragen", "Ajouter un rendez-vous")}
      footer={
        <>
          <button onClick={onClose} disabled={saving} className="bv-btn bv-btn-ghost bv-tap">
            {T("Cancel", "Abbrechen", "Annuler")}
          </button>
          <button onClick={save} disabled={saving} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {T("Save", "Speichern", "Enregistrer")}
          </button>
        </>
      }
    >
      {/* px-5 py-4 like every other Modal caller — Modal doesn't pad its own
          children, so without this the form sits flush against the edges. */}
      <div className="grid gap-4 px-5 py-4">
        <p className="text-[13px]" style={{ color: "var(--w3)" }}>
          {T("For calls agreed on WhatsApp or by phone. They get the same follow-up reminders as a self-booked call.",
             "Für Termine, die per WhatsApp oder Telefon vereinbart wurden. Sie erhalten dieselben Follow-up-Erinnerungen wie selbst gebuchte.",
             "Pour les appels convenus par WhatsApp ou téléphone. Ils reçoivent les mêmes relances qu'une réservation en ligne.")}
        </p>

        <div className="flex gap-2 flex-wrap">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k} type="button" onClick={() => setKind(k)}
              className="bv-tap px-3 py-2 text-[13px]"
              style={{
                borderRadius: 10,
                border: `1px solid ${kind === k ? "var(--border-gold)" : "var(--border)"}`,
                background: kind === k ? "rgba(212,175,55,.08)" : "var(--card)",
                color: kind === k ? "var(--gold)" : "var(--w2)",
              }}
              aria-pressed={kind === k}
            >
              {T(KIND_LABEL[k].en, KIND_LABEL[k].de, KIND_LABEL[k].fr)}
            </button>
          ))}
        </div>

        <div>
          <label className="bv-label" htmlFor="ab-name">{T("Name", "Name", "Nom")}</label>
          <input id="ab-name" className="bv-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>

        {isOrg && (
          <div>
            <label className="bv-label" htmlFor="ab-org">{T("Organisation", "Organisation", "Organisation")}</label>
            <input id="ab-org" className="bv-input" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bv-label" htmlFor="ab-when">{T("When", "Wann", "Quand")}</label>
            <input id="ab-when" className="bv-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="bv-label" htmlFor="ab-min">{T("Length", "Dauer", "Durée")}</label>
            <select id="ab-min" className="bv-input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bv-label" htmlFor="ab-email">
              {T("Email", "E-Mail", "E-mail")} <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span>
            </label>
            <input id="ab-email" className="bv-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          </div>
          <div>
            <label className="bv-label" htmlFor="ab-phone">
              {T("Phone", "Telefon", "Téléphone")} <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span>
            </label>
            <input id="ab-phone" className="bv-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
        </div>

        <div>
          <label className="bv-label" htmlFor="ab-note">{T("Note", "Notiz", "Note")}</label>
          <textarea id="ab-note" className="bv-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ resize: "vertical" }} />
        </div>

        <label className="flex items-center gap-2.5 text-[13.5px] bv-tap" style={{ color: "var(--w2)" }}>
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
          {T("Email them a calendar invite", "Kalendereinladung per E-Mail senden", "Envoyer une invitation par e-mail")}
        </label>
        {invite && !email.trim() && (
          <p className="text-[12px] -mt-2" style={{ color: "var(--w3)" }}>
            {T("No email given — the event is added to your calendar only.",
               "Keine E-Mail angegeben — der Termin wird nur in Ihren Kalender eingetragen.",
               "Aucun e-mail — l'événement est ajouté à votre agenda uniquement.")}
          </p>
        )}

        {err && <p className="text-[13px]" style={{ color: "#ef4444" }} role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
