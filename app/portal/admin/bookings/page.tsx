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
import { AddBookingModal } from "@/components/AddBookingModal";
import { QUESTIONS, type Selections } from "@/lib/booking";
import {
  ArrowLeft, Plus, Video, Phone, Mail, Loader2, Check, X, CalendarDays, Building2,
  SlidersHorizontal, Link2, UserPlus, UserCheck, Copy, ChevronDown,
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

/** One shareable booking link — /book/<slug>. NULL override = inherit the global. */
type EventType = {
  slug: string;
  kind: Kind;
  active: boolean;
  /** Full public URL, built server-side from the PROD origin, not the tab's. */
  url: string;
  slot_minutes: number | null;
  buffer_minutes: number | null;
  min_notice_hours: number | null;
  horizon_days: number | null;
  title: { en: string; de: string; fr: string };
  blurb: { en: string; de: string; fr: string };
};

/** What an unset override resolves to right now — the global availability row. */
type LinkDefaults = {
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  horizon_days: number;
  accepting: boolean;
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
  const [types, setTypes] = useState<EventType[]>([]);
  const [linkDefaults, setLinkDefaults] = useState<LinkDefaults | null>(null);
  const [typesMigrated, setTypesMigrated] = useState(true);
  /** Why the links panel is missing. A CODE, not a sentence: translating in
   *  here would put `T` — which changes with the language — into loadTypes's
   *  deps, and loadTypes is a dep of the bootstrap effect, so switching
   *  language would re-run the whole page load. */
  const [typesErr, setTypesErr] = useState<null | "expired" | "failed">(null);

  const load = useCallback(async (tk: string) => {
    const r = await fetch("/api/portal/admin/bookings", { headers: { Authorization: `Bearer ${tk}` }, cache: "no-store" });
    if (r.status === 401 || r.status === 403) { router.replace("/portal/admin"); return; }
    const j = await r.json().catch(() => ({ bookings: [] }));
    setRows((j.bookings ?? []) as Booking[]);
  }, [router]);

  /** The shareable links. Sub-admins get 403 here (supreme-admin config) — the
   *  panel then simply doesn't render, rather than taking the page down. Every
   *  OTHER failure has to SAY so: silence there means the founder opens the
   *  page after a hiccup, sees no links panel and no error, and concludes the
   *  feature was never deployed. A missing panel still never costs the
   *  bookings list. */
  const loadTypes = useCallback(async (tk: string) => {
    try {
      const r = await fetch("/api/portal/admin/booking-types", { headers: { Authorization: `Bearer ${tk}` }, cache: "no-store" });
      if (r.status === 403) return; // sub-admin: correctly has no links panel
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (!j || !Array.isArray(j.types)) {
        setTypesErr(r.status === 401 ? "expired" : "failed");
        return;
      }
      setTypes(j.types as EventType[]);
      setLinkDefaults((j.defaults ?? null) as LinkDefaults | null);
      setTypesMigrated(j.migrated !== false);
      setTypesErr(null);
    } catch {
      setTypesErr("failed");
    }
  }, []);

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
      // Both are above-the-fold, so they reveal together — a links panel that
      // pops in a moment after the list is the FOUC the loading pattern exists
      // to prevent.
      await Promise.allSettled([load(tk), loadTypes(tk)]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load, loadTypes]);

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

      {!types.length && typesErr && (
        <p className="text-[13px] mb-6" style={{ color: "#ef4444" }} role="alert">
          {typesErr === "expired"
            ? T("Your session expired — reload the page to see your booking links.",
                "Ihre Sitzung ist abgelaufen — laden Sie die Seite neu, um Ihre Buchungslinks zu sehen.",
                "Votre session a expiré — rechargez la page pour voir vos liens de réservation.")
            : T("Couldn't load your booking links. Reload the page to try again.",
                "Ihre Buchungslinks konnten nicht geladen werden. Bitte laden Sie die Seite neu.",
                "Impossible de charger vos liens de réservation. Rechargez la page.")}
        </p>
      )}

      {!!types.length && (
        <BookingLinksPanel
          token={token}
          T={T}
          lang={lang}
          types={types}
          defaults={linkDefaults}
          migrated={typesMigrated}
          onSaved={(next, nextDefaults) => { setTypes(next); if (nextDefaults) setLinkDefaults(nextDefaults); }}
        />
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

/* ── The shareable booking links ──────────────────────────────────────────────
 * /book/nurse, /book/clinic, /book/company — the URLs the founder hands to a
 * candidate or a clinic. Copying one is the panel's primary job, so it is one
 * tap with no menu in front of it.
 *
 * The four durations below each link are OVERRIDES. Empty means NULL in the
 * database, which means "inherit the global availability" — so every empty box
 * spells out the value it is currently inheriting. A blank input alone cannot
 * tell "inherits 30" apart from "explicitly 30", and that distinction is the
 * whole feature: change the global and the first follows, the second doesn't.
 * -------------------------------------------------------------------------- */

type OverrideKey = "slot_minutes" | "buffer_minutes" | "min_notice_hours" | "horizon_days";

const OVERRIDE_RANGE: Record<OverrideKey, [number, number]> = {
  slot_minutes: [5, 240],
  buffer_minutes: [0, 120],
  min_notice_hours: [0, 720],
  horizon_days: [1, 90],
};

const OVERRIDE_LABEL: Record<OverrideKey, { en: string; de: string; fr: string }> = {
  slot_minutes:     { en: "Call length",     de: "Termindauer",             fr: "Durée de l'appel" },
  buffer_minutes:   { en: "Gap after",       de: "Puffer danach",           fr: "Pause après" },
  min_notice_hours: { en: "Minimum notice",  de: "Mindestvorlauf",          fr: "Préavis minimum" },
  horizon_days:     { en: "Book up to",      de: "Buchbar bis",             fr: "Réservable jusqu'à" },
};

function BookingLinksPanel({
  token, T, lang, types, defaults, migrated, onSaved,
}: {
  token: string;
  T: (en: string, de: string, fr: string) => string;
  lang: string;
  types: EventType[];
  defaults: LinkDefaults | null;
  migrated: boolean;
  onSaved: (types: EventType[], defaults: LinkDefaults | null) => void;
}) {
  return (
    <section className="mb-9">
      <p className="bv-eyebrow mb-3">{T("Your booking links", "Ihre Buchungslinks", "Vos liens de réservation")}</p>

      {!migrated && (
        <p
          role="alert"
          className="rounded-xl px-4 py-3 text-[13px] mb-3"
          style={{ background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.35)", color: "var(--w)" }}
        >
          {T("These links work, but their settings aren't stored yet — run supabase/booking_event_types.sql to be able to change them.",
             "Die Links funktionieren, ihre Einstellungen sind aber noch nicht gespeichert — führen Sie supabase/booking_event_types.sql aus, um sie ändern zu können.",
             "Ces liens fonctionnent, mais leurs réglages ne sont pas encore enregistrés — exécutez supabase/booking_event_types.sql pour pouvoir les modifier.")}
        </p>
      )}

      <div className="grid gap-2">
        {types.map((et) => (
          <LinkCard
            key={et.slug}
            et={et}
            T={T}
            lang={lang}
            token={token}
            defaults={defaults}
            editable={migrated}
            onSaved={onSaved}
          />
        ))}
      </div>

      {defaults && (
        <p className="text-[12px] mt-2.5" style={{ color: "var(--w3)" }}>
          {T(
            `Global settings, used wherever a link sets nothing of its own: ${defaults.slot_minutes} min call, ${defaults.buffer_minutes} min gap, ${defaults.min_notice_hours} h notice, ${defaults.horizon_days} days ahead.`,
            `Globale Einstellungen, gültig überall dort, wo ein Link nichts Eigenes setzt: ${defaults.slot_minutes} Min. Termin, ${defaults.buffer_minutes} Min. Puffer, ${defaults.min_notice_hours} Std. Vorlauf, ${defaults.horizon_days} Tage im Voraus.`,
            `Réglages globaux, utilisés partout où un lien ne définit rien : appel de ${defaults.slot_minutes} min, pause de ${defaults.buffer_minutes} min, préavis de ${defaults.min_notice_hours} h, ${defaults.horizon_days} jours à l'avance.`,
          )}
          {" "}
          {!defaults.accepting && T("Bookings are currently closed for every link.",
            "Buchungen sind derzeit für alle Links geschlossen.",
            "Les réservations sont actuellement fermées pour tous les liens.")}
        </p>
      )}
    </section>
  );
}

function LinkCard({
  et, T, lang, token, defaults, editable, onSaved,
}: {
  et: EventType;
  T: (en: string, de: string, fr: string) => string;
  lang: string;
  token: string;
  defaults: LinkDefaults | null;
  editable: boolean;
  onSaved: (types: EventType[], defaults: LinkDefaults | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const [saving, setSaving] = useState(false);
  /** WHAT was saved, so the confirmation can't claim the four numbers were
   *  stored when all that happened was the on/off switch. */
  const [saved, setSaved] = useState<null | "active" | "fields">(null);
  const [err, setErr] = useState<string | null>(null);

  // "" = inherit. Kept as strings so an empty box stays empty instead of
  // collapsing to 0 the moment it is touched.
  const asDraft = useCallback((t: EventType) => ({
    slot_minutes: t.slot_minutes == null ? "" : String(t.slot_minutes),
    buffer_minutes: t.buffer_minutes == null ? "" : String(t.buffer_minutes),
    min_notice_hours: t.min_notice_hours == null ? "" : String(t.min_notice_hours),
    horizon_days: t.horizon_days == null ? "" : String(t.horizon_days),
  }), []);

  const [draft, setDraft] = useState<Record<OverrideKey, string>>(() => asDraft(et));
  const [active, setActive] = useState(et.active);

  // The server hands back the whole refreshed list after every save, so this
  // card's props change under it — re-sync, or the box would keep showing what
  // was typed rather than what was stored.
  //
  // But re-sync ONLY on what actually changed. Keyed on `et`, every save on
  // ANY card handed this one a new object and wiped the four boxes: type 45
  // into Call length, untick "Link is live", and the 45 vanished while a green
  // "Saved" appeared — the founder walks away believing 45 min is live when
  // the column is still NULL.
  useEffect(() => { setActive(et.active); }, [et.active]);
  useEffect(() => {
    setDraft(asDraft(et));
    // Deliberately the four stored numbers, not `et`: an active-only save
    // leaves them identical, so an edit in progress survives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [et.slug, et.slot_minutes, et.buffer_minutes, et.min_notice_hours, et.horizon_days, asDraft]);

  const title = lang === "de" ? et.title.de : lang === "fr" ? et.title.fr : et.title.en;
  const label = (k: OverrideKey) => T(OVERRIDE_LABEL[k].en, OVERRIDE_LABEL[k].de, OVERRIDE_LABEL[k].fr);

  async function copy() {
    setCopyErr(false);
    try {
      await navigator.clipboard.writeText(et.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyErr(true);
    }
  }

  /** Returns whether the write landed, so an optimistic checkbox can roll back. */
  async function save(patch: Record<string, unknown>, what: "active" | "fields" = "fields"): Promise<boolean> {
    setSaving(true);
    setErr(null);
    setSaved(null);
    try {
      const r = await fetch("/api/portal/admin/booking-types", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: et.slug, ...patch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The server names the value it refused rather than clamping it, so say
        // which one — the founder shouldn't have to guess across four boxes.
        if (j?.error === "out_of_range" && j?.field in OVERRIDE_RANGE) {
          const f = j.field as OverrideKey;
          setErr(T(
            `${label(f)} must be between ${j.min} and ${j.max}, or empty to inherit.`,
            `${label(f)} muss zwischen ${j.min} und ${j.max} liegen — oder leer bleiben, um zu erben.`,
            `${label(f)} doit être entre ${j.min} et ${j.max}, ou vide pour hériter.`,
          ));
        } else if (j?.error === "not_migrated") {
          setErr(T("Run supabase/booking_event_types.sql first.",
            "Bitte zuerst supabase/booking_event_types.sql ausführen.",
            "Exécutez d'abord supabase/booking_event_types.sql."));
        } else if (j?.error === "unknown_type") {
          setErr(T("This link no longer exists. Reload the page.",
            "Diesen Link gibt es nicht mehr. Bitte die Seite neu laden.",
            "Ce lien n'existe plus. Rechargez la page."));
        } else {
          setErr(T("Couldn't save.", "Konnte nicht gespeichert werden.", "Échec de l'enregistrement."));
        }
        return false;
      }
      if (Array.isArray(j?.types)) onSaved(j.types as EventType[], (j.defaults ?? null) as LinkDefaults | null);
      setSaved(what);
      setTimeout(() => setSaved(null), 2200);
      return true;
    } catch {
      setErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v.trim()));

  return (
    <div className="bv-card" style={{ borderRadius: 14, overflow: "hidden" }}>
      <div className="p-4 flex items-start gap-3 flex-wrap">
        {/* LAW #4 — the dot carries live / not live, never a word. */}
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: 999, marginTop: 7, flexShrink: 0,
            background: et.active ? "#16a34a" : "var(--w3)",
          }}
        />
        <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
          <p className="text-[14.5px] font-medium truncate" style={{ color: "var(--w)" }}>{title}</p>
          <a
            href={et.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bv-link block text-[12.5px] mt-1 break-all"
          >
            {et.url}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copy}
            className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-1.5 text-[13px]"
            style={{ minHeight: 44, borderColor: copied ? "#16a34a" : undefined }}
            aria-label={T(`Copy the link for ${title}`, `Link für ${title} kopieren`, `Copier le lien pour ${title}`)}
          >
            {copied
              ? <><Check size={14} aria-hidden style={{ color: "#16a34a" }} /> {T("Copied", "Kopiert", "Copié")}</>
              : <><Copy size={14} aria-hidden /> {T("Copy", "Kopieren", "Copier")}</>}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-1.5 text-[13px]"
            style={{ minHeight: 44 }}
            aria-expanded={open}
            aria-label={T(`Settings for ${title}`, `Einstellungen für ${title}`, `Réglages pour ${title}`)}
          >
            <SlidersHorizontal size={14} aria-hidden />
            <ChevronDown size={13} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .18s" }} />
          </button>
        </div>
        {copyErr && (
          <p className="w-full text-[12.5px]" style={{ color: "#ef4444" }} role="alert">
            {T("Couldn't copy — select the link above and copy it by hand.",
               "Kopieren fehlgeschlagen — markieren Sie den Link oben und kopieren Sie ihn manuell.",
               "Copie impossible — sélectionnez le lien ci-dessus et copiez-le à la main.")}
          </p>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4 grid gap-4" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <label className="flex items-center gap-2.5 text-[13.5px] bv-tap" style={{ color: "var(--w2)", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={active}
              disabled={saving || !editable}
              onChange={async (e) => {
                const v = e.target.checked;
                const prev = active;
                setActive(v);
                // If the write fails the database still says `prev` — don't
                // leave the box, and the "Not found page" warning under it,
                // contradicting the status dot in the header.
                const ok = await save({ active: v }, "active");
                if (!ok) setActive(prev);
              }}
            />
            {T("Link is live", "Link ist aktiv", "Lien actif")}
          </label>
          {!active && (
            <p className="text-[12.5px] -mt-3" style={{ color: "var(--w3)" }}>
              {T("Anyone opening this link gets a Not found page. Nothing already booked is affected.",
                 "Wer diesen Link öffnet, sieht eine Nicht-gefunden-Seite. Bereits gebuchte Termine bleiben bestehen.",
                 "Ce lien affiche une page introuvable. Les rendez-vous déjà pris ne changent pas.")}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(OVERRIDE_RANGE) as OverrideKey[]).map((k) => (
              <OverrideField
                key={k}
                id={`et-${et.slug}-${k}`}
                label={label(k)}
                value={draft[k]}
                disabled={saving || !editable}
                min={OVERRIDE_RANGE[k][0]}
                max={OVERRIDE_RANGE[k][1]}
                unit={k === "min_notice_hours" ? T("h", "Std.", "h") : k === "horizon_days" ? T("days", "Tage", "jours") : T("min", "Min.", "min")}
                inherited={defaults ? defaults[k] : null}
                onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))}
                T={T}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => save({
                slot_minutes: num(draft.slot_minutes),
                buffer_minutes: num(draft.buffer_minutes),
                min_notice_hours: num(draft.min_notice_hours),
                horizon_days: num(draft.horizon_days),
              }, "fields")}
              disabled={saving || !editable}
              className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2 text-[13px]"
              style={{ minHeight: 44 }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
              {T("Save", "Speichern", "Enregistrer")}
            </button>
            {saved && (
              <span className="text-[13px]" style={{ color: "#16a34a" }} role="status">
                {saved === "active"
                  ? T("Saved.", "Gespeichert.", "Enregistré.")
                  : T("Saved — this link uses these now.", "Gespeichert — dieser Link nutzt das jetzt.", "Enregistré — ce lien l'utilise maintenant.")}
              </span>
            )}
            {err && <span className="text-[13px]" style={{ color: "#ef4444" }} role="alert">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One override box. EMPTY IS A REAL VALUE here — it means "inherit" — so the
 * line underneath always names the number actually in force, whether it comes
 * from this link or from the global settings.
 */
function OverrideField({
  id, label, value, onChange, inherited, unit, min, max, disabled, T,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  inherited: number | null;
  unit: string;
  min: number;
  max: number;
  disabled: boolean;
  T: (en: string, de: string, fr: string) => string;
}) {
  const overriding = value.trim() !== "";
  return (
    <div>
      <label className="bv-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="bv-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        style={{ minHeight: 44 }}
        placeholder={inherited == null
          ? T("inherit", "erben", "hériter")
          : `${T("inherit", "erben", "hériter")} · ${inherited} ${unit}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[12px] mt-1" style={{ color: overriding ? "var(--gold)" : "var(--w3)" }}>
        {overriding
          ? T(`Only this link. Leave empty to go back to the global setting${inherited == null ? "" : ` (${inherited} ${unit})`}.`,
              `Nur dieser Link. Leer lassen, um wieder die globale Einstellung zu nutzen${inherited == null ? "" : ` (${inherited} ${unit})`}.`,
              `Ce lien uniquement. Laissez vide pour revenir au réglage global${inherited == null ? "" : ` (${inherited} ${unit})`}.`)
          : inherited == null
            ? T("Inherits the global setting.", "Erbt die globale Einstellung.", "Hérite du réglage global.")
            : T(`Inherits the global setting: ${inherited} ${unit}.`,
                `Erbt die globale Einstellung: ${inherited} ${unit}.`,
                `Hérite du réglage global : ${inherited} ${unit}.`)}
      </p>
    </div>
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
  /** Set when the CURRENT availability could not be read. While it is set the
   *  form is not trustworthy, so saving is blocked — see the loader below. */
  const [loadErr, setLoadErr] = useState<string | null>(null);

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
        // A failed load must NOT fall through to an empty form. It did: the body
        // was swallowed, `a` became {}, every field reset to its default, the
        // week rendered blank — and the founder's next Save would have written
        // that blank week straight over their real availability. An expired
        // token on a page left open is enough to trigger it.
        if (!r.ok || !j?.availability) {
          setLoadErr(r.status === 401 || r.status === 403
            ? T("Your session expired — reload the page before changing anything.",
                "Ihre Sitzung ist abgelaufen — laden Sie die Seite neu, bevor Sie etwas ändern.",
                "Votre session a expiré — rechargez la page avant de modifier quoi que ce soit.")
            : T("Couldn't load your availability. Reload before editing, so you don't overwrite it.",
                "Verfügbarkeit konnte nicht geladen werden. Vor dem Bearbeiten neu laden, um sie nicht zu überschreiben.",
                "Impossible de charger vos disponibilités. Rechargez avant de modifier, pour ne pas les écraser."));
          return;
        }
        const a = j.availability ?? {};
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
      } catch {
        setLoadErr(T("Couldn't load your availability. Reload before editing, so you don't overwrite it.",
          "Verfügbarkeit konnte nicht geladen werden. Vor dem Bearbeiten neu laden, um sie nicht zu überschreiben.",
          "Impossible de charger vos disponibilités. Rechargez avant de modifier, pour ne pas les écraser."));
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
        // The server now names the exact value it rejected. Show that instead of
        // a generic "check the hours" — the founder should not have to hunt
        // through seven days to find the one they mistyped.
        const details: string[] = Array.isArray(j?.details) ? j.details : [];
        setErr(j?.error === "not_migrated"
          ? T("Run supabase/booking_maxx.sql first.", "Bitte zuerst supabase/booking_maxx.sql ausführen.", "Exécutez d'abord supabase/booking_maxx.sql.")
          : j?.error === "bad_week"
            ? (details.length
                ? details.slice(0, 4).join(" ")
                : T("Check the hours — each one must look like 09:00-13:00.",
                    "Zeiten prüfen — jede muss wie 09:00-13:00 aussehen.",
                    "Vérifiez les horaires — chacun doit ressembler à 09:00-13:00."))
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
          {/* Saving is blocked while the current availability is unknown — the
              form would be showing defaults, not their hours, and Save would
              write those defaults over the real thing. */}
          <button onClick={save} disabled={saving || loading || !!loadErr} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {T("Save", "Speichern", "Enregistrer")}
          </button>
        </>
      }
    >
      <div className="grid gap-4 px-5 py-4">
        {loadErr ? (
          <div
            role="alert"
            className="rounded-xl px-4 py-3 text-[13px]"
            style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.35)", color: "var(--w)" }}
          >
            {loadErr}
          </div>
        ) : null}
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
                onClick={() => {
                  // Confirm first: this is not a local state change. The server
                  // deletes the Google event, emails the person that their call
                  // is off and drops their follow-ups — and there is no undo.
                  // It sat one stray click away from a real customer being told
                  // their appointment was cancelled.
                  const who = b.name || b.email || T("this person", "diese Person", "cette personne");
                  if (!window.confirm(T(
                    `Cancel this booking? ${who} will be emailed that it's off, and the calendar event is removed.`,
                    `Diese Buchung absagen? ${who} erhält eine E-Mail über die Absage, und der Kalendereintrag wird entfernt.`,
                    `Annuler cette réservation ? ${who} recevra un e-mail d'annulation et l'événement sera supprimé du calendrier.`,
                  ))) return;
                  onPatch(b.id, { status: "cancelled" });
                }}
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
