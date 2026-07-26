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
} from "lucide-react";

type Kind = "nurse" | "clinic" | "company";
type Status = "booked" | "held" | "no_show" | "cancelled";

type Booking = {
  id: number; kind: Kind; name: string; email: string | null; phone: string | null;
  company: string | null; note: string | null; selections: Selections | null;
  starts_at: string; ends_at: string; meet_link: string | null;
  status: Status; outcome: string | null; source: "public" | "admin"; created_at: string;
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
  const [busyId, setBusyId] = useState<number | null>(null);

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

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up = rows.filter((b) => Date.parse(b.starts_at) >= now && b.status !== "cancelled")
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const pa = rows.filter((b) => !up.includes(b));
    return { upcoming: up, past: pa };
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
        <button onClick={() => setAddOpen(true)} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
          <Plus size={15} strokeWidth={2} /> {T("Add by hand", "Manuell eintragen", "Ajouter manuellement")}
        </button>
      </div>

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
                <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} />
              ))}
            </Section>
          )}
          {!!past.length && (
            <Section title={T("Past", "Vergangen", "Passés")}>
              {past.map((b) => (
                <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} />
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
    </main>
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
  b, T, lang, fmt, busy, onPatch,
}: {
  b: Booking;
  T: (en: string, de: string, fr: string) => string;
  lang: string;
  fmt: (iso: string) => string;
  busy: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
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
      <div className="grid gap-4">
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
