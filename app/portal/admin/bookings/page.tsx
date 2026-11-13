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
  Plus, Video, Phone, Mail, Loader2, Check, X, CalendarDays, Building2,
  SlidersHorizontal, Link2, UserPlus, UserCheck, Copy, ChevronDown, ChevronRight,
} from "lucide-react";
import { PageHead, Btn, Card, Seg, Dot, Field, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT, type Status as KitStatus } from "@/components/fx/kit";

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

// LAW #4 — colour carries the status, never a text label (the one palette, components/fx/kit).
const STATUS_COLOR: Record<Status, KitStatus> = {
  booked:    "pending",  // upcoming / not yet resolved — orange
  held:      "approved", // it happened — green
  no_show:   "rejected", // they didn't turn up — red
  cancelled: "missing",  // grey
};

// The page's own small classes: one hairline row per call (phone: name over kind, time on the right).
const BOOKINGS_CSS = `
.bkg-row{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px 11px 14px;border-radius:12px;background:var(--card);border:1px solid var(--border);text-align:left;cursor:pointer;font-family:inherit;color:var(--w)}
.bkg-row:hover{background:var(--bg2)}
.bkg-main{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px}
.bkg-who{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.bkg-kind{flex:none;font-size:12.5px;color:var(--w3);white-space:nowrap}
.bkg-when{flex:none;font-size:12.5px;color:var(--w2);white-space:nowrap;font-variant-numeric:tabular-nums}
@media (max-width:640px){
.bkg-main{flex-direction:column;align-items:flex-start;gap:1px}
.bkg-who{max-width:100%}
.bkg-hide-ph{display:none!important}
.bkg-ib{width:36px;padding:0!important}
}`;

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
    <main id="bv-main" className="mx-auto px-5 bv-page-bottom" style={{ maxWidth: 880, paddingTop: 88, paddingBottom: 20 }}>
      <style>{BOOKINGS_CSS}</style>
      <PageHead
        back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Bookings", "Termine", "Rendez-vous")}
        sub={<>{upcoming.length} {T("upcoming", "anstehend", "à venir")} · {rows.length} {T("total", "gesamt", "au total")}</>}
        actions={<>
          <Btn size="sm" onClick={() => setAvailOpen(true)}>
            <SlidersHorizontal size={14} strokeWidth={2} />{T("My availability", "Meine Zeiten", "Mes disponibilités")}
          </Btn>
          <Btn kind="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} strokeWidth={2} />{T("Add by hand", "Manuell eintragen", "Ajouter manuellement")}
          </Btn>
        </>}
      />

      {poolErr && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: STATUS_DOT.rejected }} role="alert">{poolErr}</p>
      )}

      {!types.length && typesErr && (
        <p style={{ margin: "0 0 14px", fontSize: 13, color: STATUS_DOT.rejected }} role="alert">
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
        <Card>
          <Empty icon={<CalendarDays size={20} aria-hidden />}>
            {T("No bookings yet. They'll appear here as soon as someone books at /book — or add one by hand.",
               "Noch keine Termine. Sie erscheinen hier, sobald jemand unter /book bucht — oder tragen Sie einen manuell ein.",
               "Aucun rendez-vous. Ils apparaîtront ici dès qu'une réservation est faite sur /book — ou ajoutez-en un manuellement.")}
          </Empty>
        </Card>
      ) : (
        <BookingLists T={T} upcoming={upcoming} cancelled={cancelled} past={past}
          row={(b) => <Row key={b.id} b={b} T={T} lang={lang} fmt={fmt} busy={busyId === b.id} onPatch={patch} onPool={pool} />} />
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

/**
 * THE universal booking link — the one you actually hand out.
 *
 * Deliberately not driven by the event-type list: it is a fixed, permanent
 * address that works whether or not any migration has run, whether or not a
 * type is switched off, and whether or not the DB is reachable. The thing you
 * put in an email signature must never depend on configuration.
 *
 * /bookings and /booking both 308 to it (next.config.ts), because those are what
 * people actually type — and until that redirect existed they landed on the
 * generic site shell with no calendar and no error.
 */
function UniversalLinkCard({ T, onDirect }: { T: (en: string, de: string, fr: string) => string; onDirect?: () => void }) {
  const url = "https://www.borivon.com/bookings";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context / permission) — the link is
      // selectable text right there, so say so rather than fail silently.
      setCopied(false);
      alert(url);
    }
  };
  return (
    <Card style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px 14px", padding: "12px 14px 12px 16px" }}>
      <span aria-hidden className="bkg-hide-ph" style={{ flex: "none", width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--bg2)", color: "var(--gold)" }}>
        <Link2 size={16} />
      </span>
      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--w3)" }}>{T("Your booking link", "Ihr Buchungslink", "Votre lien de réservation")}</span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14.5, fontWeight: 500, color: "var(--w)", textDecoration: "none", wordBreak: "break-all" }}>
            www.borivon.com/bookings
          </a>
        </div>
        <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--w3)" }}>
          {T("For anyone — it asks who they are, then shows your real times.",
             "Für alle — fragt zuerst, wer bucht, und zeigt dann Ihre echten Zeiten.",
             "Pour tous — demande d'abord qui réserve, puis montre vos vraies disponibilités.")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flex: "none" }}>
        <Btn size="sm" onClick={copy}>
          {copied
            ? <><Check size={14} aria-hidden style={{ color: STATUS_DOT.approved }} />{T("Copied", "Kopiert", "Copié")}</>
            : <><Copy size={14} aria-hidden />{T("Copy link", "Link kopieren", "Copier le lien")}</>}
        </Btn>
        {onDirect && (
          <Btn kind="quiet" size="sm" onClick={onDirect}>{T("Direct links", "Direkte Links", "Liens directs")}</Btn>
        )}
      </div>
    </Card>
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
  // The per-audience links open in a popup (LAW #36) instead of unfolding the page (nobody scrolls).
  const [direct, setDirect] = useState(false);
  const globalLine = defaults
    ? T(
        `Global settings, used wherever a link sets nothing of its own: ${defaults.slot_minutes} min call, ${defaults.buffer_minutes} min gap, ${defaults.min_notice_hours} h notice, ${defaults.horizon_days} days ahead.`,
        `Globale Einstellungen, gültig überall dort, wo ein Link nichts Eigenes setzt: ${defaults.slot_minutes} Min. Termin, ${defaults.buffer_minutes} Min. Puffer, ${defaults.min_notice_hours} Std. Vorlauf, ${defaults.horizon_days} Tage im Voraus.`,
        `Réglages globaux, utilisés partout où un lien ne définit rien : appel de ${defaults.slot_minutes} min, pause de ${defaults.buffer_minutes} min, préavis de ${defaults.min_notice_hours} h, ${defaults.horizon_days} jours à l'avance.`,
      )
    : "";
  const closedLine = defaults && !defaults.accepting
    ? T("Bookings are currently closed for every link.",
        "Buchungen sind derzeit für alle Links geschlossen.",
        "Les réservations sont actuellement fermées pour tous les liens.")
    : "";
  return (
    <section style={{ marginBottom: 14 }}>
      {/* THE ONE LINK. Everything else on this page is optional.
          /book already asks the visitor who they are before showing the
          calendar, so a single address serves nurses, clinics and companies —
          which is what you hand out on a call, put in a signature, or say out
          loud. Three competing links is a decision the person sharing has to
          make every time, and the wrong one is a worse first impression than no
          link at all. */}
      <UniversalLinkCard T={T} onDirect={() => setDirect(true)} />

      {!migrated && (
        <p role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "8px 2px 0", fontSize: 12.5, color: "var(--w2)" }}>
          <span style={{ marginTop: 5 }}><Dot st="pending" size={7} /></span>
          {T("These links work, but their settings aren't stored yet — run supabase/booking_event_types.sql to be able to change them.",
             "Die Links funktionieren, ihre Einstellungen sind aber noch nicht gespeichert — führen Sie supabase/booking_event_types.sql aus, um sie ändern zu können.",
             "Ces liens fonctionnent, mais leurs réglages ne sont pas encore enregistrés — exécutez supabase/booking_event_types.sql pour pouvoir les modifier.")}
        </p>
      )}
      {closedLine && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 2px 0", fontSize: 12.5, color: "var(--w2)" }}>
          <Dot st="pending" size={7} />{closedLine}
        </p>
      )}

      {/* The per-audience links still exist for when you deliberately want to
          skip the "who are you?" step — a company you already know is a
          company. Folded away so it is a choice, not the default. */}
      <Modal open={direct} onClose={() => setDirect(false)} size="md"
        title={T("Direct links per audience (optional)",
                 "Direkte Links pro Zielgruppe (optional)",
                 "Liens directs par public (facultatif)")}
        subtitle={T("These skip the first question and open straight on the calendar. Use them when you already know who you are sending it to.",
                    "Diese überspringen die erste Frage und öffnen direkt den Kalender. Nutzen Sie sie, wenn Sie bereits wissen, an wen Sie senden.",
                    "Ils sautent la première question et ouvrent directement le calendrier. À utiliser quand vous savez déjà à qui vous l'envoyez.")}>
        <div className="px-5 py-4" style={{ display: "grid", gap: 8 }}>
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
          {defaults && (
            <p style={{ margin: "6px 2px 0", fontSize: 12, lineHeight: 1.5, color: "var(--w3)" }}>
              {globalLine}{closedLine ? ` ${closedLine}` : ""}
            </p>
          )}
        </div>
      </Modal>
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
    <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", padding: "10px 10px 10px 14px" }}>
        {/* LAW #4 — the dot carries live / not live, never a word. */}
        <Dot st={et.active ? "approved" : "missing"} size={8} />
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
          <a href={et.url} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", marginTop: 1, fontSize: 12.5, color: "var(--w3)", textDecoration: "none", wordBreak: "break-all" }}>
            {et.url}
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
          <Btn size="sm" onClick={copy}
            style={copied ? { borderColor: STATUS_DOT.approved } : undefined}
            aria-label={T(`Copy the link for ${title}`, `Link für ${title} kopieren`, `Copier le lien pour ${title}`)}>
            {copied
              ? <><Check size={14} aria-hidden style={{ color: STATUS_DOT.approved }} />{T("Copied", "Kopiert", "Copié")}</>
              : <><Copy size={14} aria-hidden />{T("Copy", "Kopieren", "Copier")}</>}
          </Btn>
          <Btn kind="quiet" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            aria-label={T(`Settings for ${title}`, `Einstellungen für ${title}`, `Réglages pour ${title}`)}>
            <SlidersHorizontal size={14} aria-hidden />
            <ChevronDown size={13} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .18s" }} />
          </Btn>
        </div>
        {copyErr && (
          <p style={{ width: "100%", margin: 0, fontSize: 12.5, color: STATUS_DOT.rejected }} role="alert">
            {T("Couldn't copy — select the link above and copy it by hand.",
               "Kopieren fehlgeschlagen — markieren Sie den Link oben und kopieren Sie ihn manuell.",
               "Copie impossible — sélectionnez le lien ci-dessus et copiez-le à la main.")}
          </p>
        )}
      </div>

      {open && (
        <div style={{ display: "grid", gap: 14, padding: "14px", borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--w2)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={active}
              disabled={saving || !editable}
              style={{ width: 16, height: 16, accentColor: "var(--w)" }}
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
            <p style={{ margin: "-6px 0 0", fontSize: 12.5, color: "var(--w3)" }}>
              {T("Anyone opening this link gets a Not found page. Nothing already booked is affected.",
                 "Wer diesen Link öffnet, sieht eine Nicht-gefunden-Seite. Bereits gebuchte Termine bleiben bestehen.",
                 "Ce lien affiche une page introuvable. Les rendez-vous déjà pris ne changent pas.")}
            </p>
          )}

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Btn kind="primary" size="sm"
              onClick={() => save({
                slot_minutes: num(draft.slot_minutes),
                buffer_minutes: num(draft.buffer_minutes),
                min_notice_hours: num(draft.min_notice_hours),
                horizon_days: num(draft.horizon_days),
              }, "fields")}
              disabled={saving || !editable}
            >
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
              {T("Save", "Speichern", "Enregistrer")}
            </Btn>
            {saved && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--w2)" }} role="status">
                <Dot st="approved" size={7} />
                {saved === "active"
                  ? T("Saved.", "Gespeichert.", "Enregistré.")
                  : T("Saved — this link uses these now.", "Gespeichert — dieser Link nutzt das jetzt.", "Enregistré — ce lien l'utilise maintenant.")}
              </span>
            )}
            {err && <span style={{ fontSize: 13, color: STATUS_DOT.rejected }} role="alert">{err}</span>}
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
      <Field label={label}>
        <input
          id={id}
          className="bvk-input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          placeholder={inherited == null
            ? T("inherit", "erben", "hériter")
            : `${T("inherit", "erben", "hériter")} · ${inherited} ${unit}`}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <p style={{ margin: "5px 0 0", fontSize: 12, lineHeight: 1.45, color: overriding ? "var(--w)" : "var(--w3)", fontWeight: overriding ? 500 : 400 }}>
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
const DAY_SHORT: Record<number, { en: string; de: string; fr: string }> = {
  1: { en: "Mon", de: "Mo", fr: "Lun" },
  2: { en: "Tue", de: "Di", fr: "Mar" },
  3: { en: "Wed", de: "Mi", fr: "Mer" },
  4: { en: "Thu", de: "Do", fr: "Jeu" },
  5: { en: "Fri", de: "Fr", fr: "Ven" },
  6: { en: "Sat", de: "Sa", fr: "Sam" },
  0: { en: "Sun", de: "So", fr: "Dim" },
};
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
  const dayShort = (d: number) => T(DAY_SHORT[d].en, DAY_SHORT[d].de, DAY_SHORT[d].fr);

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title={T("My availability", "Meine Zeiten", "Mes disponibilités")}
      footer={
        <>
          <Btn kind="quiet" size="sm" onClick={onClose} disabled={saving}>
            {T("Close", "Schließen", "Fermer")}
          </Btn>
          {/* Saving is blocked while the current availability is unknown — the
              form would be showing defaults, not their hours, and Save would
              write those defaults over the real thing. */}
          <Btn kind="primary" size="sm" onClick={save} disabled={saving || loading || !!loadErr}>
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {T("Save", "Speichern", "Enregistrer")}
          </Btn>
        </>
      }
    >
      <div className="px-5 py-4" style={{ display: "grid", gap: 12 }}>
        {loadErr ? (
          <p role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: 0, padding: "10px 12px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
            {loadErr}
          </p>
        ) : null}
        {loading ? (
          <div className="bv-skeleton" style={{ height: 260, borderRadius: 14 }} aria-busy="true" />
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--w2)", cursor: "pointer" }}>
              <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--w)" }} />
              {T("Accepting bookings", "Termine annehmen", "Accepter les réservations")}
            </label>
            {!accepting && (
              <p style={{ margin: "-8px 0 0", fontSize: 12.5, color: "var(--w3)" }}>
                {T("/book will show no times and invite people to email instead. Nothing is deleted.",
                   "/book zeigt keine Zeiten und bittet um eine E-Mail. Es wird nichts gelöscht.",
                   "/book n'affichera aucun créneau et invitera à écrire. Rien n'est supprimé.")}
              </p>
            )}

            <div className="bvk-field">
              <span>{T("Working hours", "Arbeitszeiten", "Heures de travail")}</span>
              <div style={{ display: "grid", gap: "6px 14px", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                {DAY_KEYS.map((d) => (
                  <div key={d} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span aria-hidden style={{ flex: "none", width: 28, fontSize: 12.5, color: "var(--w3)" }}>{dayShort(d)}</span>
                    <input
                      className="bvk-input"
                      style={{ height: 38 }}
                      value={week[d] ?? ""}
                      placeholder={T("closed", "geschlossen", "fermé")}
                      onChange={(e) => setWeek((w) => ({ ...w, [d]: e.target.value }))}
                      aria-label={dayName(d)}
                    />
                  </div>
                ))}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--w3)", textTransform: "none", letterSpacing: 0 }}>
                {T("Comma-separated, e.g. 09:00-13:00, 14:00-18:00. Leave a day empty to close it.",
                   "Kommagetrennt, z. B. 09:00-13:00, 14:00-18:00. Leer lassen = geschlossen.",
                   "Séparés par des virgules, ex. 09:00-13:00, 14:00-18:00. Laissez vide pour fermer.")}
              </p>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <Field label={T("Appointment length", "Termindauer", "Durée du rendez-vous")}>
                <select id="av-slot" className="bvk-input" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                  {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </Field>
              <Field label={T("Gap between calls", "Puffer zwischen Terminen", "Pause entre les appels")}>
                <select id="av-buffer" className="bvk-input" value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
                  {[0, 5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>{m === 0 ? T("none", "keiner", "aucune") : `${m} min`}</option>
                  ))}
                </select>
              </Field>
              <Field label={T("Minimum notice", "Mindestvorlauf", "Préavis minimum")}>
                <select id="av-notice" className="bvk-input" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
                  {[0, 2, 4, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>{h === 0 ? T("none", "keiner", "aucun") : `${h} h`}</option>
                  ))}
                </select>
              </Field>
              <Field label={T("Book up to", "Buchbar bis", "Réservable jusqu'à")}>
                <select id="av-horizon" className="bvk-input" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                  {[7, 14, 21, 30, 60].map((d) => (
                    <option key={d} value={d}>{d} {T("days ahead", "Tage im Voraus", "jours à l'avance")}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <Field label={T("Days off", "Freie Tage", "Jours de congé")}>
                <textarea
                  id="av-blackout" className="bvk-input" rows={2} value={blackout}
                  onChange={(e) => setBlackout(e.target.value)} style={{ minHeight: 60 }}
                  placeholder="2026-08-15&#10;2026-12-25"
                />
              </Field>
              <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--w3)" }}>
                {T("One date per line (YYYY-MM-DD). Nothing is offered on these days.",
                   "Ein Datum pro Zeile (JJJJ-MM-TT). An diesen Tagen wird nichts angeboten.",
                   "Une date par ligne (AAAA-MM-JJ). Aucun créneau ces jours-là.")}
              </p>
            </div>

            <a href="/book" target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w)", textDecoration: "underline", textUnderlineOffset: 3, justifySelf: "start" }}>
              <Link2 size={13} aria-hidden /> {T("Preview the booking page", "Buchungsseite ansehen", "Voir la page de réservation")}
            </a>

            {err && <p style={{ margin: 0, fontSize: 13, color: STATUS_DOT.rejected }} role="alert">{err}</p>}
            {saved && (
              <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 13, color: "var(--w2)" }} role="status">
                <Dot st="approved" size={7} />
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

/** Upcoming · Cancelled · Past as one segmented filter, the chosen list flipping page by page (nobody scrolls). */
function BookingLists({ T, upcoming, cancelled, past, row }: {
  T: (en: string, de: string, fr: string) => string;
  upcoming: Booking[];
  cancelled: Booking[];
  past: Booking[];
  row: (b: Booking) => React.ReactNode;
}) {
  type View = "up" | "cancelled" | "past";
  const tabs = ([
    ["up", T("Upcoming", "Anstehend", "À venir"), upcoming],
    ["cancelled", T("Cancelled", "Abgesagt", "Annulés"), cancelled],
    ["past", T("Past", "Vergangen", "Passés"), past],
  ] as [View, string, Booking[]][]).filter(([, , list]) => list.length > 0);
  const [view, setView] = useState<View>(upcoming.length ? "up" : past.length ? "past" : "cancelled");
  const cur = tabs.find(([k]) => k === view) ?? tabs[0];
  const { slice, page, pages, setPage } = usePaged(cur ? cur[2] : [], 8, 4);
  if (!cur) return null;
  return (
    <section>
      <div style={{ marginBottom: 10 }}>
        <Seg value={cur[0]} onChange={(v) => { setView(v); setPage(0); }}
          options={tabs.map(([k, label, list]) => [k, `${label} ${list.length}`] as [View, string])} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{slice.map(row)}</div>
      <Pager page={page} pages={pages} onPage={setPage} />
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

  const kindLabel = lang === "de" ? kl.de : lang === "fr" ? kl.fr : kl.en;
  const linkStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, color: "var(--w)", textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "var(--border2)", wordBreak: "break-all" };
  const ico: React.CSSProperties = { flex: "none", color: "var(--w3)" };

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="bkg-row" aria-expanded={open}>
        <Dot st={STATUS_COLOR[b.status]} size={8} />
        <span className="bkg-main">
          <span className="bkg-who">{who}</span>
          <span className="bkg-kind">
            {kindLabel}
            {b.source === "admin" && (
              <span title={T("Added by hand", "Manuell eingetragen", "Ajouté manuellement")}> · {T("manual", "manuell", "manuel")}</span>
            )}
          </span>
        </span>
        <span className="bkg-when">{fmt(b.starts_at)}</span>
        <ChevronRight size={15} aria-hidden style={ico} />
      </button>

      {/* The call's details and what came of it, in the universal popup (LAW #36) — the list never grows. */}
      <Modal open={open} onClose={() => setOpen(false)} busy={busy} size="sm" title={who}
        subtitle={`${kindLabel} · ${fmt(b.starts_at)}${b.source === "admin" ? ` · ${T("manual", "manuell", "manuel")}` : ""}`}>
        <div className="px-5 py-4" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 8, fontSize: 13.5, color: "var(--w2)" }}>
            {b.company && <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Building2 size={14} aria-hidden style={ico} /> {b.name}</span>}
            {b.email && <a style={linkStyle} href={`mailto:${b.email}`}><Mail size={14} aria-hidden style={ico} /> {b.email}</a>}
            {b.phone && <a style={linkStyle} href={`tel:${b.phone.replace(/\s/g, "")}`}><Phone size={14} aria-hidden style={ico} /> {b.phone}</a>}
            {b.meet_link && (
              <a style={linkStyle} href={b.meet_link} target="_blank" rel="noopener noreferrer">
                <Video size={14} aria-hidden style={ico} /> {T("Join video call", "Videoanruf beitreten", "Rejoindre la visio")}
              </a>
            )}
            {b.note && <span style={{ color: "var(--w3)" }}>{b.note}</span>}
          </div>

          {/* What they ticked — the reason the form asks in taps instead of prose. */}
          {!!b.selections && Object.keys(b.selections).length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {(QUESTIONS[b.kind] ?? []).map((q) => {
                const ids = b.selections?.[q.id];
                if (!ids?.length) return null;
                const labels = ids
                  .map((id) => q.options.find((o) => o.id === id))
                  .filter((o): o is NonNullable<typeof o> => !!o)
                  .map((o) => (lang === "de" ? o.de : lang === "fr" ? o.fr : o.en));
                return (
                  <div key={q.id} className="bvk-field" style={{ gap: 3 }}>
                    <span>{lang === "de" ? q.de : lang === "fr" ? q.fr : q.en}</span>
                    <div style={{ fontSize: 13.5, color: "var(--w)" }}>{labels.join(" · ")}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* What happened — the field the follow-ups actually feed on. */}
          {past && (
            <Field label={T("What came out of it?", "Was kam dabei heraus?", "Qu'en est-il ressorti ?")}>
              <textarea
                id={`out-${b.id}`} className="bvk-input" rows={2} value={outcome} maxLength={2000}
                onChange={(e) => setOutcome(e.target.value)} style={{ minHeight: 64 }}
              />
            </Field>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {past && (
              <>
                <Btn size="sm" onClick={() => onPatch(b.id, { status: "held", outcome })} disabled={busy}
                  style={b.status === "held" ? { borderColor: STATUS_DOT.approved } : undefined}>
                  <Check size={14} aria-hidden style={{ color: STATUS_DOT.approved }} />{T("It happened", "Hat stattgefunden", "A eu lieu")}
                </Btn>
                <Btn size="sm" onClick={() => onPatch(b.id, { status: "no_show", outcome })} disabled={busy}
                  style={b.status === "no_show" ? { borderColor: STATUS_DOT.rejected } : undefined}>
                  <X size={14} aria-hidden style={{ color: STATUS_DOT.rejected }} />{T("No show", "Nicht erschienen", "Absent")}
                </Btn>
              </>
            )}
            {b.status !== "cancelled" && (
              <Btn kind="danger" size="sm"
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
              >
                {T("Cancel", "Absagen", "Annuler")}
              </Btn>
            )}
            {/* A nurse who books is exactly the person the Pool is for. Clinics
                and companies are counterparties, not candidates — no button. */}
            {b.kind === "nurse" && (
              b.pooled_user_id ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--w2)", padding: "0 6px" }}>
                  <UserCheck size={14} aria-hidden style={{ color: STATUS_DOT.approved }} /> {T("In the pool", "Im Pool", "Dans le vivier")}
                </span>
              ) : (
                <Btn size="sm" onClick={() => onPool(b.id)} disabled={busy}>
                  <UserPlus size={14} aria-hidden />{T("Add to pool", "In den Pool", "Ajouter au vivier")}
                </Btn>
              )
            )}
            {busy && <Loader2 size={14} className="animate-spin" style={{ color: "var(--w3)" }} aria-hidden />}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Manual scheduling — the WhatsApp/phone bookings that never touch /book. */
