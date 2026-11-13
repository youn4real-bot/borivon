"use client";

/**
 * Community Calendar (the "Calendar" tab) — Skool-style.
 *
 *  • Month grid view (Mon-start) with event chips in day cells.
 *  • Top-right toggle to a List view of the whole month's events.
 *  • Month navigation (‹ ›) + "Today" + a live Casablanca clock.
 *  • VIP-only events render as locked cards; their join link + description are
 *    withheld server-side from non-premium candidates (see the API route).
 *  • Supreme admin can add (click any empty day, or the + button) and delete.
 *
 * All event timing is shown in Africa/Casablanca time regardless of the
 * viewer's device timezone. Run supabase/calendar_events.sql first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cachedRole } from "@/lib/myRole";
import { fetchCalendar, calendarEmptyKind } from "@/lib/calendarLoad";
import { withTimeout } from "@/lib/authNet";
import { useLang } from "@/components/LangContext";
import { AddBookingModal } from "@/components/AddBookingModal";
import { PageLoader } from "@/components/ui/states";
import { Modal } from "@/components/ui/Modal";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { PageHead, Btn, Card, Seg, Dot, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT } from "@/components/fx/kit";
import {
  ChevronLeft, ChevronRight, CalendarDays, Lock, Plus,
  Trash2, MapPin, Video, Clock, CalendarPlus, Crown, Repeat, Users, Pencil, ChevronDown, CalendarCheck, ExternalLink, Loader2,
  AlertTriangle,
} from "lucide-react";

const TZ = "Africa/Casablanca";

// ── Timezone helpers ─────────────────────────────────────────────────────────
// One shared formatter to read the Casablanca calendar parts of any instant.
const PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function casaParts(d: Date) {
  const o: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(d)) if (p.type !== "literal") o[p.type] = p.value;
  let hh = parseInt(o.hour ?? "0", 10); if (hh === 24) hh = 0;
  return { y: +o.year, m: +o.month, d: +o.day, hh, mm: +o.minute };
}
const pad = (n: number) => String(n).padStart(2, "0");
function casaYMD(d: Date) { const p = casaParts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }

/** Wall-clock "YYYY-MM-DD" + "HH:MM" in Casablanca → UTC ISO string. */
function casaWallToISO(dateStr: string, timeStr: string): string | null {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = (timeStr || "00:00").split(":").map(Number);
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;
  const naiveUTC = Date.UTC(y, mo - 1, d, h, mi);
  const shown = casaParts(new Date(naiveUTC));
  const shownUTC = Date.UTC(shown.y, shown.m - 1, shown.d, shown.hh, shown.mm);
  const offset = shownUTC - naiveUTC; // Casablanca is ahead of UTC by `offset` ms
  return new Date(naiveUTC - offset).toISOString();
}

type Ev = {
  id: string; title: string; description: string;
  starts_at: string; ends_at: string | null;
  image_url: string; link_url: string; location: string;
  vip_only: boolean; locked: boolean; attendee_ids?: string[];
  /** Which calendar this came from. Absent on legacy rows → treated as portal. */
  source?: "portal" | "booking" | "google";
  /** Lives in Google; the portal can show it but never edit or delete it. */
  readOnly?: boolean;
  /** Present on source==="booking": who booked, and how to reach them. */
  booking?: {
    id: number; kind: string; name: string; company: string | null;
    email: string | null; phone: string | null; status: string;
    meetLink: string | null; addedByHand: boolean;
  };
};

/**
 * One dot per source, so the merged diary reads at a glance:
 *   gold  = a Borivon community event (what this page always showed)
 *   green = somebody booked a call — click through for the Meet link
 *   grey  = the founder's own Google Workspace time; the slot is simply taken
 */
const SOURCE_DOT: Record<NonNullable<Ev["source"]>, string> = {
  portal: "var(--gold)",
  booking: STATUS_DOT.approved,
  google: "var(--w3)",
};
/** The same three as soft tints (the one design: colour is a quiet tint, never a loud fill). */
const SOURCE_TINT: Record<NonNullable<Ev["source"]>, string> = {
  portal: "color-mix(in srgb, var(--gold) 13%, transparent)",
  booking: STATUS_TINT.approved,
  google: "var(--bg2)",
};

/** Nobody scrolls: the month is one screen. A day cell gets a sixth of what the
 *  viewport leaves — 279px of navbar + head + month bar on a laptop, 138px more on a
 *  phone (< 640px: stacked head, two-row month bar, bottom nav; the inner clamp is
 *  that step) → 86px on 1280×800, ~71px on 390×844. `extra` = what else sits above
 *  the grid (the "could not load" strip). Shows CHIPS events, the rest as "+N more"
 *  (the day panel lists them all). */
const cellH = (extra = 0) => `clamp(46px, calc((100dvh - ${279 + extra}px - clamp(0px, calc((640px - 100vw) * 999), 138px)) / 6), 86px)`;
const CHIPS = 2;

type TaggedPerson = { id: string; name: string };
type Draft = {
  title: string; description: string; date: string; time: string; durationMin: number;
  locationType: "online" | "inperson"; link: string; place: string; image: string;
  attendees: TaggedPerson[]; recurring: boolean; weeks: number;
};
const EMPTY_DRAFT: Draft = {
  title: "", description: "", date: "", time: "18:00", durationMin: 120,
  locationType: "online", link: "", place: "", image: "",
  attendees: [], recurring: false, weeks: 4,
};

function personInitials(n: string): string {
  const parts = n.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

// German date format TT.MM.JJJJ (DD.MM.YYYY), always — independent of browser
// locale. Internally the value is still ISO "YYYY-MM-DD" (for casaWallToISO).
function germanFromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
function isoFromGerman(de: string): string {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(de.trim());
  if (!m) return "";
  const d = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Text date field locked to German TT.MM.JJJJ, auto-inserting the dots. */
function GermanDateInput({ value, onChange, className }: { value: string; onChange: (iso: string) => void; className?: string }) {
  const [text, setText] = useState(germanFromIso(value));
  useEffect(() => { setText(germanFromIso(value)); }, [value]);
  return (
    <input className={className} inputMode="numeric" placeholder="TT.MM.JJJJ" maxLength={10} value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
        const out = digits.length > 4 ? `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
          : digits.length > 2 ? `${digits.slice(0, 2)}.${digits.slice(2)}`
          : digits;
        setText(out);
        onChange(isoFromGerman(out));
      }} />
  );
}

// ── "Add to calendar" (personal) — deep links + .ics download ────────────────
// Lets ANY viewer drop the event into their own Outlook / Google / Apple / etc.
// calendar. All timestamps are UTC; each provider renders them in the user's
// own zone, so the wall-clock stays correct regardless of where they are.
function icsStamp(d: Date): string {
  // → "YYYYMMDDTHHMMSSZ"
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function eventWindow(ev: Ev): { start: Date; end: Date } {
  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}
function eventBody(ev: Ev): string {
  const parts: string[] = [];
  if (ev.description) parts.push(ev.description);
  if (ev.link_url) parts.push(`Link: ${ev.link_url}`);
  return parts.join("\n\n");
}
function calendarUrls(ev: Ev): Record<"outlook" | "google" | "yahoo", string> {
  const { start, end } = eventWindow(ev);
  const e = encodeURIComponent;
  const title = ev.title || "Event";
  const loc = ev.location || ev.link_url || "";
  const body = eventBody(ev);
  const sB = icsStamp(start), eB = icsStamp(end);
  const sIso = start.toISOString(), eIso = end.toISOString();
  return {
    outlook:   `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${e(title)}&startdt=${e(sIso)}&enddt=${e(eIso)}&body=${e(body)}&location=${e(loc)}`,
    google:    `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${e(title)}&dates=${sB}/${eB}&details=${e(body)}&location=${e(loc)}`,
    yahoo:     `https://calendar.yahoo.com/?v=60&title=${e(title)}&st=${sB}&et=${eB}&desc=${e(body)}&in_loc=${e(loc)}`,
  };
}
function escapeICS(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** Apple Calendar (+ any desktop app): download a standards .ics file. */
function downloadICS(ev: Ev) {
  const { start, end } = eventWindow(ev);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Borivon//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.id}@borivon.com`,
    `DTSTAMP:${icsStamp(start)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeICS(ev.title)}`,
    `DESCRIPTION:${escapeICS(eventBody(ev))}`,
    `LOCATION:${escapeICS(ev.location || ev.link_url || "")}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(ev.title || "event").replace(/[^\w-]+/g, "_").slice(0, 50)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Calendar providers, in the order shown. The viewer's last pick is remembered
// (localStorage) and becomes the default button action.
// Outlook covers all Microsoft calendars (Outlook.com / Microsoft 365 personal);
// kept as one entry, first, since "Outlook" and "Microsoft 365" are the same product.
type CalKey = "outlook" | "google" | "apple" | "yahoo";
const CAL_OPTIONS: { key: CalKey; label: string }[] = [
  { key: "outlook", label: "Outlook" },
  { key: "google",  label: "Google Calendar" },
  { key: "apple",   label: "Apple Calendar" },
  { key: "yahoo",   label: "Yahoo" },
];
const CAL_PROVIDER_LABEL = (k: CalKey): string => CAL_OPTIONS.find((o) => o.key === k)?.label ?? "";
const CAL_STORAGE_KEY = "bv_cal_provider";

export default function CalendarPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const locale = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";
  const DURATIONS: { v: number; label: string }[] = [
    { v: 30, label: T("30 min", "30 Min.", "30 min") },
    { v: 60, label: T("1 hour", "1 Stunde", "1 heure") },
    { v: 90, label: T("1.5 hours", "1,5 Stunden", "1 h 30") },
    { v: 120, label: T("2 hours", "2 Stunden", "2 heures") },
    { v: 180, label: T("3 hours", "3 Stunden", "3 heures") },
  ];

  const [loading, setLoading] = useState(true);
  /** EMPTY vs BROKEN. A failed read used to render the same calm sentence a
   *  quiet month shows ("No events this month"), and a dropped request left
   *  her on the spinner with nothing to tap at all. This drives the difference
   *  and the retry. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [events, setEvents] = useState<Ev[]>([]);
  const [canManage, setCanManage] = useState(false);
  // Staff = supreme admin or a Borivon (non-agency) sub-admin. They get the
  // MERGED diary — community events + booked calls + the founder's Google time —
  // and can put an appointment straight into it from here.
  const [isStaff, setIsStaff] = useState(false);
  // Appointment modal — opens ON the day you clicked, so booking a call is done
  // where you were already looking instead of on another page.
  const [apptWhen, setApptWhen] = useState<string | null>(null);
  // The booking modal does its own POST, so it needs a bearer token of its own
  // (authedFetch resolves one per call and can't hand it out).
  const [apptToken, setApptToken] = useState("");
  // Moving / cancelling one of the founder's own Google events from here.
  const [gEditBusy, setGEditBusy] = useState(false);
  const [gEditErr, setGEditErr] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [now, setNow] = useState<Date>(() => new Date());

  // Displayed month (Casablanca-based, 0-indexed month).
  const [cursor, setCursor] = useState<{ y: number; m: number }>(() => {
    const p = casaParts(new Date());
    return { y: p.y, m: p.m - 1 };
  });

  const [detail, setDetail] = useState<Ev | null>(null);
  const [dayPanel, setDayPanel] = useState<string | null>(null); // ymd
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null); // null = creating, else editing this event
  const [saving, setSaving] = useState(false);
  // People taggable as attendees (candidates + sub-admins + org admins).
  const [people, setPeople] = useState<{ id: string; name: string; email: string; kind: string; photo: string | null }[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  // "Add to calendar" on the event detail (every user). The viewer's last-picked
  // provider is remembered and becomes the default button action; the pencil
  // reopens the provider list.
  const [addCalOpen, setAddCalOpen] = useState(false);
  const [calDefault, setCalDefault] = useState<CalKey | null>(null);
  const addCalRef = useRef<HTMLDivElement>(null);
  // Calendar subscription ("Sync") — one-time setup, then auto-updates.
  const [feedToken, setFeedToken] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Google instant-sync (OAuth push) connection state.
  const [googleSync, setGoogleSync] = useState<{ configured: boolean; connected: boolean; email: string | null }>({ configured: false, connected: false, email: null });
  const [gBusy, setGBusy] = useState(false);

  // ── Auth'd fetch (fresh token, same stale-token guard as other pages) ───────
  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    // Deadlines on both: neither getSession nor refreshSession takes an
    // AbortSignal, and a token refresh over a stalled connection used to hang
    // every caller of this helper — including the bootstrap, which then never
    // reached setLoading(false) and left her on the spinner.
    const { data: { session } } = await withTimeout(supabase.auth.getSession());
    let token = session?.access_token ?? "";
    const expMs = (session?.expires_at ?? 0) * 1000;
    if (!expMs || expMs - Date.now() < 60_000) {
      try { const { data: r } = await withTimeout(supabase.auth.refreshSession()); if (r?.session?.access_token) token = r.session.access_token; } catch { /* keep token */ }
    }
    return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
  }, []);

  /**
   * Read the month. Never throws, and never turns a failure into an empty
   * month — those were the two halves of the same bug (see lib/calendarLoad).
   */
  const load = useCallback(async () => {
    let res;
    try {
      res = await fetchCalendar<Ev>(authedFetch);
    } catch {
      // authedFetch itself gave up (a timed-out session refresh).
      setLoadFailed(true);
      return;
    }
    if (!res.ok) {
      if (res.status === 401) { router.replace("/portal"); return; }
      // Leave whatever is on screen alone and let the empty state say the
      // read failed. Permissions that DID arrive are still honoured, so the
      // admin's "+" survives a failed events query.
      if (res.perms) {
        setCanManage((prev) => prev || res.perms!.canManage);
        setIsStaff((prev) => prev || res.perms!.isStaff);
      }
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setEvents(res.data.events);
    // Never let a server hiccup turn OFF the admin "+" — OR it with the cache-seeded value.
    setCanManage((prev) => prev || res.data.canManage);
    setIsStaff((prev) => prev || res.data.isStaff);
    if (res.data.feedToken) setFeedToken(res.data.feedToken);
    if (res.data.googleSync) setGoogleSync(res.data.googleSync);
  }, [authedFetch, router]);

  /** "Try again" from the failed empty state. */
  const retryLoad = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try { await load(); } finally { setRetrying(false); }
  }, [load, retrying]);

  // Taggable people (admins only). Powers the attendee tagger in the Add-event
  // modal + resolves tagged names in the detail view.
  const fetchPeople = useCallback(async () => {
    try {
      const res = await authedFetch("/api/portal/admin/users");
      if (!res.ok) return;
      const j = await res.json().catch(() => ({ users: [] }));
      setPeople((Array.isArray(j.users) ? j.users : []).map((u: { id: string; name?: string; email?: string; kind?: string; photo?: string | null }) => ({
        id: u.id, name: u.name || u.email || "—", email: u.email || "", kind: u.kind || "candidate", photo: u.photo ?? null,
      })));
      setPeopleLoaded(true);
    } catch { /* ignore */ }
  }, [authedFetch]);
  useEffect(() => { if (canManage && !peopleLoaded) void fetchPeople(); }, [canManage, peopleLoaded, fetchPeople]);

  // Keep a fresh token for the booking modal. JWTs roll about hourly, so a
  // calendar left open overnight must not hand the modal a dead one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Deadline + catch: this one is not on the render path, but a getSession
      // that never settles leaves a floating promise for the life of the tab,
      // and an unhandled rejection where a missing token is recoverable —
      // onAuthStateChange below refreshes it on the next token roll anyway.
      const { data: { session } } = await withTimeout(supabase.auth.getSession());
      if (!cancelled && session?.access_token) setApptToken(session.access_token);
    })().catch(() => { /* the auth listener below supplies the token instead */ });
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (sess?.access_token) setApptToken(sess.access_token);
    });
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, []);

  // Bootstrap.
  // The spinner is released in a `finally`, whatever happens. It used to be
  // released on the line AFTER `await load()`, so a single rejected request —
  // or a session refresh that never answered — threw straight past it and left
  // her looking at <PageLoader/> for as long as she was willing to wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession());
        if (!session?.user) { router.replace("/portal"); return; }
        // Show the admin "+ Add event" button INSTANTLY from the cached role —
        // independent of the calendar fetch — so the supreme admin always gets it.
        if (cachedRole(session.user.id) === "admin") setCanManage(true);
        await load();
      } catch {
        // Could not even establish who she is. Show the page with the failed
        // empty state and a retry rather than an endless spinner.
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load, router]);

  // Live Casablanca clock (every 30s — also rolls "today" over at midnight)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close the add-to-calendar dropdown whenever the open event changes/closes.
  useEffect(() => { setAddCalOpen(false); }, [detail]);

  // Returning from the Google OAuth consent screen → open the Sync panel and
  // refresh the connection status; strip the ?google param so refresh is clean.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("google");
    if (!p) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState({}, "", url.pathname + url.search);
    if (p === "connected") { setSyncOpen(true); void load(); }
  }, [load]);

  // Remember the viewer's preferred calendar provider across sessions.
  useEffect(() => {
    try {
      const v = localStorage.getItem(CAL_STORAGE_KEY);
      if (v && CAL_OPTIONS.some((o) => o.key === v)) setCalDefault(v as CalKey);
    } catch { /* ignore */ }
  }, []);

  // ── Derived calendar data ───────────────────────────────────────────────────
  const todayYMD = casaYMD(now);

  const weekdayLabels = useMemo(() => {
    const base = Date.UTC(2024, 0, 1, 12); // 2024-01-01 is a Monday
    const f = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(base + i * 86400000)));
  }, [locale]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(cursor.y, cursor.m, 1, 12))),
    [locale, cursor],
  );

  const clock = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(now),
    [locale, now],
  );

  const grid = useMemo(() => {
    const first = Date.UTC(cursor.y, cursor.m, 1, 12);
    const mondayIdx = (new Date(first).getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(first + (i - mondayIdx) * 86400000);
      const m = dt.getUTCMonth();
      const ymd = `${dt.getUTCFullYear()}-${pad(m + 1)}-${pad(dt.getUTCDate())}`;
      return { ymd, day: dt.getUTCDate(), inMonth: m === cursor.m };
    });
  }, [cursor]);

  /** ISO instant → the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in the
   *  viewer's own clock (which is what they are about to type in). */
  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** Holds whatever the admin typed into the move field, without re-rendering
   *  the modal on every keystroke. */
  const gMoveRef = useRef<string>("");

  /**
   * Say what actually went wrong, instead of blaming Google for everything.
   *
   * Both handlers used to show one flat "Google refused the change" for any
   * failure. The most likely failure by far is the 409 on a booked call — where
   * Google refused nothing, the PORTAL did, on purpose, because moving the
   * Google side alone would leave the booker's confirmation, reminder and
   * follow-ups pinned to the old time. Telling the founder that Google said no
   * sends them to the wrong place; telling them to use Bookings gets it done.
   */
  async function googleEditError(r: Response, op: "move" | "cancel"): Promise<string> {
    const code = await r.json().then((j) => String(j?.error ?? "")).catch(() => "");
    if (code === "belongs_to_booking") {
      return op === "move"
        ? T("This is a booked call — reschedule it from Bookings so the person is told and their reminders move too.",
            "Das ist ein gebuchtes Gespräch — verschieben Sie es unter Buchungen, damit die Person informiert wird und ihre Erinnerungen mitwandern.",
            "C'est un appel réservé — reprogrammez-le depuis Réservations pour que la personne soit prévenue et que ses rappels suivent.")
        : T("This is a booked call — cancel it from Bookings so the person is told and their follow-ups stop.",
            "Das ist ein gebuchtes Gespräch — sagen Sie es unter Buchungen ab, damit die Person informiert wird und die Nachfassungen stoppen.",
            "C'est un appel réservé — annulez-le depuis Réservations pour que la personne soit prévenue et que les relances s'arrêtent.");
    }
    if (r.status === 404 || code === "event_not_found") {
      return T("That event no longer exists in Google Calendar.",
        "Dieser Termin existiert nicht mehr im Google Kalender.",
        "Cet événement n'existe plus dans Google Agenda.");
    }
    if (code === "workspace_not_connected") {
      return T("Google Calendar isn't connected right now.",
        "Google Kalender ist derzeit nicht verbunden.",
        "Google Agenda n'est pas connecté pour le moment.");
    }
    return op === "move"
      ? T("Google refused the change.", "Google hat die Änderung abgelehnt.", "Google a refusé la modification.")
      : T("Google refused the cancellation.", "Google hat die Absage abgelehnt.", "Google a refusé l'annulation.");
  }

  /** Move one of the founder's own Google events. Duration is preserved server
   *  side when no end is sent, so a 2h meeting never shrinks to 1h. */
  async function moveGoogle(ev: Ev) {
    const raw = gMoveRef.current;
    const at = Date.parse(raw);
    if (!raw || !Number.isFinite(at)) {
      setGEditErr(T("Pick a new date and time first.", "Bitte zuerst Datum und Uhrzeit wählen.", "Choisissez d'abord une date et une heure."));
      return;
    }
    setGEditBusy(true); setGEditErr(null);
    try {
      const r = await authedFetch("/api/portal/calendar/google", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: ev.id.replace(/^google:/, ""), startsAt: at }),
      });
      if (!r.ok) {
        setGEditErr(await googleEditError(r, "move"));
        return;
      }
      setDetail(null); gMoveRef.current = ""; await load();
    } catch {
      setGEditErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally { setGEditBusy(false); }
  }

  /** Cancel a Google event. Confirmed first — it emails any attendees and there
   *  is no undo from here. */
  async function cancelGoogle(ev: Ev) {
    if (!window.confirm(T("Cancel this event in Google Calendar?", "Diesen Termin im Google Kalender absagen?", "Annuler cet événement dans Google Agenda ?"))) return;
    setGEditBusy(true); setGEditErr(null);
    try {
      const r = await authedFetch(`/api/portal/calendar/google?eventId=${encodeURIComponent(ev.id.replace(/^google:/, ""))}`, { method: "DELETE" });
      if (!r.ok) {
        setGEditErr(await googleEditError(r, "cancel"));
        return;
      }
      setDetail(null); await load();
    } catch {
      setGEditErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally { setGEditBusy(false); }
  }

  /** datetime-local string for the appointment modal: a given day at 10:00,
   *  or the next round hour when no day was clicked. */
  function apptWhenFor(ymd?: string): string {
    if (ymd) return `${ymd}T10:00`;
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
  }
  const defaultApptWhen = () => apptWhenFor();

  const eventsByDay = useMemo(() => {
    const map: Record<string, Ev[]> = {};
    for (const e of events) (map[casaYMD(new Date(e.starts_at))] ??= []).push(e);
    for (const k in map) map[k].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return map;
  }, [events]);

  const monthEvents = useMemo(
    () => events
      .filter((e) => { const p = casaParts(new Date(e.starts_at)); return p.y === cursor.y && p.m - 1 === cursor.m; })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [events, cursor],
  );

  // ── Formatters ───────────────────────────────────────────────────────────────
  const fmtTime = useCallback((iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(iso)), [locale]);
  const fmtRange = useCallback((e: Ev) =>
    e.ends_at ? `${fmtTime(e.starts_at)} – ${fmtTime(e.ends_at)}` : fmtTime(e.starts_at), [fmtTime]);
  const fmtFullDate = useCallback((iso: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date(iso)), [locale]);

  // ── Navigation ────────────────────────────────────────────────────────────────
  const goPrev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const goNext = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  const goToday = () => { const p = casaParts(new Date()); setCursor({ y: p.y, m: p.m - 1 }); };

  // ── Admin actions ─────────────────────────────────────────────────────────────
  const openAdd = (ymd?: string) => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, date: ymd ?? casaYMD(now) });
    setTagQuery("");
    void fetchPeople();
    setAddOpen(true);
  };

  // Open the same modal pre-filled to EDIT an existing event.
  const openEdit = (ev: Ev) => {
    const start = new Date(ev.starts_at);
    const sp = casaParts(start);
    const rawDur = ev.ends_at ? Math.round((Date.parse(ev.ends_at) - Date.parse(ev.starts_at)) / 60_000) : 120;
    const durationMin = [30, 60, 90, 120, 180].includes(rawDur) ? rawDur : 120;
    setEditingId(ev.id);
    setDraft({
      title: ev.title,
      description: ev.description ?? "",
      date: casaYMD(start),
      time: `${pad(sp.hh)}:${pad(sp.mm)}`,
      durationMin,
      locationType: ev.link_url ? "online" : "inperson",
      link: ev.link_url ?? "",
      place: ev.location ?? "",
      image: ev.image_url ?? "",
      attendees: (ev.attendee_ids ?? []).map((id) => ({ id, name: people.find((p) => p.id === id)?.name || "—" })),
      recurring: false, weeks: 4,
    });
    setTagQuery("");
    void fetchPeople();
    setDetail(null);
    setAddOpen(true);
  };

  const closeAdd = () => { setAddOpen(false); setEditingId(null); };

  // Drop the event into the viewer's own calendar (web deep link or .ics).
  const addToCalendar = (ev: Ev, key: CalKey) => {
    if (key === "apple") { downloadICS(ev); return; }
    const url = calendarUrls(ev)[key];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  // Persist the viewer's chosen provider so it becomes the default next time.
  const chooseDefault = (key: CalKey) => {
    setCalDefault(key);
    try { localStorage.setItem(CAL_STORAGE_KEY, key); } catch { /* ignore */ }
  };
  // Localised "Add to <Provider>" (German puts the verb last).
  const addToLabel = (provider: string) =>
    lang === "de" ? `Zu ${provider} hinzufügen` : lang === "fr" ? `Ajouter à ${provider}` : `Add to ${provider}`;

  // Connect / disconnect Google instant-sync (OAuth push).
  const connectGoogle = async () => {
    setGBusy(true);
    try {
      const res = await authedFetch("/api/portal/calendar/google/connect");
      const j = await res.json().catch(() => ({}));
      if (j.url) { window.location.href = j.url as string; return; } // navigates away
    } catch { /* ignore */ }
    setGBusy(false);
  };
  const disconnectGoogle = async () => {
    setGBusy(true);
    try {
      const res = await authedFetch("/api/portal/calendar/google/disconnect", { method: "POST" });
      if (res.ok) setGoogleSync((s) => ({ ...s, connected: false, email: null }));
    } finally { setGBusy(false); }
  };

  const saveEvent = async () => {
    const startsISO = draft.date && draft.time ? casaWallToISO(draft.date, draft.time) : null;
    if (!draft.title.trim() || !startsISO) return;
    const endsISO = new Date(Date.parse(startsISO) + draft.durationMin * 60_000).toISOString();
    const repeatWeekly = draft.recurring ? Math.max(1, Math.min(52, draft.weeks || 1)) : 1;
    setSaving(true);
    try {
      const payload = {
        title: draft.title, description: draft.description,
        starts_at: startsISO, ends_at: endsISO,
        location: draft.locationType === "inperson" ? draft.place : "",
        link_url: draft.locationType === "online" ? draft.link : "",
        image_url: draft.image, vip_only: false, attendee_ids: draft.attendees.map((a) => a.id),
        repeat_weekly: repeatWeekly,
      };
      const res = editingId
        ? await authedFetch(`/api/portal/calendar?id=${encodeURIComponent(editingId)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await authedFetch("/api/portal/calendar", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
      if (res.ok) { await load(); setAddOpen(false); setEditingId(null); setDraft(EMPTY_DRAFT); }
    } finally { setSaving(false); }
  };

  const deleteEvent = async (id: string) => {
    setSaving(true);
    try {
      const res = await authedFetch(`/api/portal/calendar?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) { await load(); setDetail(null); setDayPanel(null); }
    } finally { setSaving(false); }
  };

  if (loading) return <PageLoader />;

  // ── The one design (founder 2026-11-13: "one system, one design, one everything") ──
  // Serif head with the Casablanca clock as its quiet sub line, one black pill,
  // the month fits one screen, the list flips (usePaged) instead of scrolling.
  const viewOpts: ["month" | "list", string][] = [["month", T("Grid", "Raster", "Grille")], ["list", T("List", "Liste", "Liste")]];
  const roundBtn: React.CSSProperties = {
    width: 32, height: 32, padding: 0, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)",
    color: "var(--w2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none",
  };
  const linkStyle: React.CSSProperties = { color: "var(--w)", textDecoration: "underline", textDecorationColor: "var(--border2)", textUnderlineOffset: 3 };
  const infoIcon: React.CSSProperties = { color: "var(--gold)", flexShrink: 0 };
  const gridCellH = cellH(loadFailed ? 60 : 0);   // the "could not load" strip takes ~60px above the grid

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 py-6 sm:py-10 bv-page-bottom" style={{ maxWidth: 1120 }}>
      <PageHead
        title={T("Calendar", "Kalender", "Calendrier")}
        sub={`${clock} · ${T("Casablanca time", "Casablanca-Zeit", "Heure de Casablanca")}`}
        actions={<>
          <Btn kind="ghost" size="sm" onClick={() => setSyncOpen(true)}
            title={T("Sync with your calendar", "Mit deinem Kalender synchronisieren", "Synchroniser avec votre calendrier")}>
            <CalendarCheck size={14} />{T("Sync", "Sync", "Sync")}
          </Btn>
          {/* Two different things, deliberately two buttons: an EVENT is a
              Borivon happening on the community calendar; an APPOINTMENT is a
              call with one person, which creates the Google invite, the Meet
              link and the follow-up chase. Merging them into one control would
              hide that difference. One black pill per screen: the event for the
              supreme admin, the appointment for the other staff. */}
          {isStaff && (
            <Btn kind={canManage ? "ghost" : "primary"} size="sm" onClick={() => setApptWhen(defaultApptWhen())}>
              <CalendarPlus size={14} />{T("Appointment", "Termin buchen", "Rendez-vous")}
            </Btn>
          )}
          {canManage && (
            <Btn kind="primary" size="sm" onClick={() => openAdd()}>
              <Plus size={14} strokeWidth={2.2} />{T("Add event", "Termin", "Événement")}
            </Btn>
          )}
        </>} />

      {/* Month bar — ‹ month › and Today on the left, Grid · List on the right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px 12px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={goPrev} aria-label={T("Previous month", "Vorheriger Monat", "Mois précédent")} style={roundBtn}>
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
          <span style={{ minWidth: 164, textAlign: "center", fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1.15, color: "var(--w)", textTransform: "capitalize", whiteSpace: "nowrap" }}>
            {monthTitle}
          </span>
          <button type="button" onClick={goNext} aria-label={T("Next month", "Nächster Monat", "Mois suivant")} style={roundBtn}>
            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
          <Btn kind="ghost" size="sm" onClick={goToday} style={{ marginLeft: 6 }}>{T("Today", "Heute", "Aujourd'hui")}</Btn>
        </div>
        <Seg value={view} options={viewOpts} onChange={setView} />
      </div>

      {/* ── "This month may be wrong" strip ──
          The grid has no empty state of its own: a failed read simply drew 35
          blank cells, which is exactly what a quiet month looks like. This
          says the difference out loud, in both views, and offers the retry the
          spinner never gave her. */}
      {loadFailed && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 14px", borderRadius: 12, background: STATUS_TINT.pending, marginBottom: 12 }}>
          <Dot st="pending" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, color: "var(--w)" }}>
            {T("Calendar not loaded — events may be missing.",
              "Kalender nicht geladen — Termine können fehlen.",
              "Calendrier non chargé — des événements peuvent manquer.")}
          </span>
          <Btn kind="quiet" size="sm" onClick={() => void retryLoad()} disabled={retrying} style={{ color: "var(--w)", fontWeight: 600 }}>
            {retrying
              ? T("Loading…", "Wird geladen…", "Chargement…")
              : T("Try again", "Erneut versuchen", "Réessayer")}
          </Btn>
        </div>
      )}

      {/* ── Month grid — one screen, never scrolls ─────────────────────────────── */}
      {view === "month" ? (
        <Card style={{ overflow: "hidden" }}>
          {/* Weekday header */}
          <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--border)" }}>
            {weekdayLabels.map((w, i) => (
              <div key={i} style={{ padding: "8px 0", textAlign: "center", fontSize: 12, color: "var(--w3)" }}>{w}</div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7">
            {grid.map((cell, i) => {
              const dayEvents = eventsByDay[cell.ymd] ?? [];
              const isToday = cell.ymd === todayYMD;
              const clickable = dayEvents.length > 0 || canManage || isStaff;
              return (
                <button key={cell.ymd + i} type="button" disabled={!clickable}
                  // Empty day: the supreme admin gets the community-event form
                  // (his page); other staff get the appointment form, since
                  // booking a call is the thing THEY come here to do.
                  onClick={() => {
                    if (dayEvents.length) setDayPanel(cell.ymd);
                    else if (canManage) openAdd(cell.ymd);
                    else if (isStaff) setApptWhen(apptWhenFor(cell.ymd));
                  }}
                  className="relative text-left flex flex-col disabled:cursor-default"
                  style={{
                    height: gridCellH, minWidth: 0, gap: 3, padding: 5, overflow: "hidden", background: "transparent",
                    borderRight: (i % 7 !== 6) ? "1px solid var(--border)" : undefined,
                    borderBottom: i < 35 ? "1px solid var(--border)" : undefined,
                    opacity: cell.inMonth ? 1 : 0.45,
                  }}>
                  {/* Day number (today = the ink circle) · how many more than the chips show */}
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, minWidth: 0 }}>
                    <span style={{
                      width: 22, height: 22, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999,
                      fontSize: 12.5, fontWeight: isToday ? 600 : 500, fontVariantNumeric: "tabular-nums",
                      ...(isToday ? { background: "var(--w)", color: "var(--bg)" } : { color: cell.inMonth ? "var(--w2)" : "var(--w3)" }),
                    }}>
                      {cell.day}
                    </span>
                    {dayEvents.length > CHIPS && (
                      <span className="hidden sm:block" style={{ fontSize: 11, color: "var(--w3)", whiteSpace: "nowrap", paddingRight: 2 }}>
                        +{dayEvents.length - CHIPS} {T("more", "mehr", "plus")}
                      </span>
                    )}
                  </span>
                  {/* Events: soft chips on desktop, dots on phones */}
                  <span className="flex flex-col min-w-0" style={{ gap: 3 }}>
                    {dayEvents.slice(0, CHIPS).map((e) => {
                      const src = e.source ?? "portal";
                      return (
                        <span key={e.id} title={e.title}
                          onClick={(ev) => { ev.stopPropagation(); setDetail(e); }}
                          className="hidden sm:flex items-center"
                          style={{
                            gap: 5, minWidth: 0, padding: "2px 6px", borderRadius: 6, fontSize: 11.5, lineHeight: "16px", fontWeight: 500, cursor: "pointer",
                            // Colour carries the SOURCE, as a soft tint — gold community
                            // event, green booked call, grey the founder's own Google time.
                            background: e.locked ? "var(--bg2)" : SOURCE_TINT[src],
                            color: e.locked ? "var(--w3)" : "var(--w)",
                          }}>
                          {e.locked
                            ? <Lock size={9} strokeWidth={2.4} className="flex-shrink-0" />
                            : <span className="flex-shrink-0" style={{ width: 5, height: 5, borderRadius: 999, background: SOURCE_DOT[src] }} />}
                          <span className="truncate"><span style={{ color: "var(--w3)", fontWeight: 400 }}>{fmtTime(e.starts_at)}</span> {e.title}</span>
                        </span>
                      );
                    })}
                    {/* Mobile dot row */}
                    {dayEvents.length > 0 && (
                      <span className="flex sm:hidden items-center gap-0.5 flex-wrap" style={{ paddingLeft: 3 }}>
                        {dayEvents.slice(0, 4).map((e) => (
                          <span key={e.id} style={{ width: 5, height: 5, borderRadius: 999, background: e.locked ? "var(--w3)" : SOURCE_DOT[e.source ?? "portal"] }} />
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : monthEvents.length === 0 ? (
        /* "Nothing on this month" and "we could not read your calendar"
           are DIFFERENT sentences now. They used to be the same one, so a
           500 on /api/portal/calendar calmly told a candidate with an
           interview that week that she had nothing on. */
        calendarEmptyKind({ loaded: !loading, failed: loadFailed, monthCount: 0 }) === "failed" ? (
          <Card>
            <Empty icon={<AlertTriangle size={24} strokeWidth={1.6} style={{ color: STATUS_DOT.pending }} />}>
              <span style={{ color: "var(--w2)" }}>
                {T("We couldn’t load your calendar.",
                  "Ihr Kalender konnte nicht geladen werden.",
                  "Impossible de charger votre calendrier.")}
              </span>
              <Btn kind="ghost" size="sm" onClick={() => void retryLoad()} disabled={retrying}>
                {retrying
                  ? T("Loading…", "Wird geladen…", "Chargement…")
                  : T("Try again", "Erneut versuchen", "Réessayer")}
              </Btn>
            </Empty>
          </Card>
        ) : (
          <Card>
            <Empty icon={<CalendarDays size={26} strokeWidth={1.5} />}>
              <span style={{ color: "var(--w2)" }}>{T("No events this month", "Keine Termine in diesem Monat", "Aucun événement ce mois-ci")}</span>
              {canManage && (
                <Btn kind="ghost" size="sm" onClick={() => openAdd()}>
                  <CalendarPlus size={14} />{T("Add the first event", "Ersten Termin hinzufügen", "Ajouter le premier événement")}
                </Btn>
              )}
            </Empty>
          </Card>
        )
      ) : (
        /* ── List view — the month's events, flipping ‹ › instead of scrolling ── */
        <EventList key={`${cursor.y}-${cursor.m}`} items={monthEvents} onOpen={setDetail} T={T} locale={locale} fmtRange={fmtRange} />
      )}

      {/* ── Day panel modal (events on one day) ───────────────────────────────── */}
      <Modal open={!!dayPanel} onClose={() => setDayPanel(null)} size="sm"
        title={dayPanel ? fmtFullDate(`${dayPanel}T12:00:00Z`) : ""}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <DayEvents key={dayPanel ?? ""} items={dayPanel ? (eventsByDay[dayPanel] ?? []) : []} fmtRange={fmtRange}
            onOpen={(e) => { setDayPanel(null); setDetail(e); }} />
          {canManage && dayPanel && (
            <Btn kind="ghost" onClick={() => { const d = dayPanel; setDayPanel(null); openAdd(d); }} style={{ width: "100%" }}>
              <Plus size={15} />{T("Add event", "Termin hinzufügen", "Ajouter un événement")}
            </Btn>
          )}
        </div>
      </Modal>

      {/* ── Event detail modal ────────────────────────────────────────────────── */}
      {/* Book an appointment right here — same form, same Google event, Meet
          link, invite and follow-up chase as the Bookings page. Opening it on
          the day you clicked is the whole point of putting it in the calendar. */}
      {apptWhen !== null && (
        <AddBookingModal
          token={apptToken}
          T={T}
          presetWhen={apptWhen}
          onClose={() => setApptWhen(null)}
          onSaved={async () => { setApptWhen(null); await load(); }}
        />
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} size="md" chromeless>
        {detail && (
          <div className="flex flex-col">
            {detail.image_url && (
              <div className="relative" style={{ maxHeight: 200, overflow: "hidden", borderRadius: "20px 20px 0 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={detail.image_url} alt="" className="w-full object-cover" style={{ maxHeight: 200, filter: detail.locked ? "blur(6px) brightness(0.55)" : undefined }} />
                {detail.locked && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1" style={{ color: "#fff" }}>
                    <Lock size={24} /> <span style={{ fontSize: 12, fontWeight: 600 }}>{T("VIP only", "Nur VIP", "VIP uniquement")}</span>
                  </span>
                )}
              </div>
            )}
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {detail.vip_only && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5, width: "fit-content", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "var(--w2)" }}>
                      <Crown size={12} style={{ color: "var(--gold)" }} /> VIP
                    </span>
                  )}
                  <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: "var(--w)", overflowWrap: "anywhere" }}>{detail.title}</h2>
                  {/* Host is ALWAYS shown as the organisation "Borivon" — never the
                      individual admin who created it (identity-masking rule). */}
                  <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--w3)" }}>
                    {T("by", "von", "par")} <span style={{ color: "var(--w2)", fontWeight: 600 }}>Borivon</span>
                  </p>
                </div>
                <button type="button" onClick={() => setDetail(null)} aria-label="Close"
                  style={{ width: 32, height: 32, flex: "none", borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13.5, color: "var(--w2)" }}>
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} style={infoIcon} /> {fmtFullDate(detail.starts_at)}</span>
                <span className="inline-flex items-center gap-2"><Clock size={14} style={infoIcon} /> {fmtRange(detail)} · {T("Casablanca time", "Casablanca-Zeit", "Heure de Casablanca")}</span>
                {detail.location && <span className="inline-flex items-center gap-2"><MapPin size={14} style={infoIcon} /> {detail.location}</span>}
                {canManage && detail.attendee_ids && detail.attendee_ids.length > 0 && (
                  <span className="inline-flex items-start gap-2">
                    <Users size={14} style={{ ...infoIcon, marginTop: 2 }} />
                    <span>{T("Tagged", "Markiert", "Tagués")}: {detail.attendee_ids.map((id) => people.find((p) => p.id === id)?.name || "—").join(", ")}</span>
                  </span>
                )}
              </div>

              {/* A booked call — who it is with, how to reach them, and the Meet
                  link, so the diary is something you can ACT on rather than just
                  read. Only staff ever receive these rows from the API. */}
              {detail.source === "booking" && detail.booking && (
                <div style={{ borderRadius: 12, padding: 14, background: STATUS_TINT.approved, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--w)" }}>
                    <Dot st="approved" size={7} />
                    {T("Booked call", "Gebuchter Termin", "Rendez-vous réservé")}
                    {detail.booking.addedByHand ? ` · ${T("added by hand", "manuell", "ajouté à la main")}` : ""}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "var(--w)" }}>
                    {detail.booking.company || detail.booking.name}
                  </span>
                  <div className="flex flex-col gap-1" style={{ fontSize: 13, color: "var(--w2)" }}>
                    {detail.booking.company && <span>{detail.booking.name}</span>}
                    {detail.booking.email && <a style={linkStyle} href={`mailto:${detail.booking.email}`}>{detail.booking.email}</a>}
                    {detail.booking.phone && <a style={linkStyle} href={`tel:${detail.booking.phone.replace(/\s/g, "")}`}>{detail.booking.phone}</a>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    {detail.booking.meetLink && (
                      <a href={detail.booking.meetLink} target="_blank" rel="noopener noreferrer" className="bvk-btn bvk-ghost bvk-sm">
                        <Video size={14} /> {T("Join the call", "Zum Termin", "Rejoindre l'appel")}
                      </a>
                    )}
                    <Btn kind="quiet" size="sm" onClick={() => { setDetail(null); router.push("/portal/admin/bookings"); }}>
                      {T("Manage", "Verwalten", "Gérer")}
                    </Btn>
                  </div>
                </div>
              )}

              {/* The founder's own Workspace time. Shown so nobody double-books
                  him; it belongs to Google and the portal never edits it. */}
              {detail.source === "google" && (
                <div style={{ borderRadius: 12, padding: 14, background: "var(--bg2)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--w2)" }}>
                    {T("From the Borivon Google Workspace calendar — this time is taken.",
                       "Aus dem Borivon-Google-Workspace-Kalender — diese Zeit ist belegt.",
                       "Depuis l'agenda Google Workspace de Borivon — ce créneau est pris.")}
                  </p>
                  {/* Seeing a clash and still having to open Google in another
                      tab defeats the point of one calendar. Supreme admin only:
                      other staff see these as "Busy" with no title, and moving
                      something you cannot read is indefensible. */}
                  {canManage && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="datetime-local"
                        className="bvk-input"
                        style={{ maxWidth: 220, height: 36, background: "var(--card)" }}
                        defaultValue={toLocalInput(detail.starts_at)}
                        onChange={(e) => { gMoveRef.current = e.target.value; }}
                        aria-label={T("New time", "Neue Zeit", "Nouvel horaire")}
                      />
                      <Btn kind="ghost" size="sm" disabled={gEditBusy} onClick={() => moveGoogle(detail)}>
                        {gEditBusy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
                        {T("Move", "Verschieben", "Déplacer")}
                      </Btn>
                      <Btn kind="quiet" size="sm" disabled={gEditBusy} onClick={() => cancelGoogle(detail)}>
                        {T("Cancel event", "Termin absagen", "Annuler")}
                      </Btn>
                    </div>
                  )}
                  {gEditErr && <p style={{ margin: 0, fontSize: 12.5, color: STATUS_DOT.rejected }} role="alert">{gEditErr}</p>}
                </div>
              )}

              {detail.locked ? (
                <div style={{ borderRadius: 12, padding: 16, background: "var(--bg2)", textAlign: "center" }}>
                  <Lock size={18} className="mx-auto" style={{ color: "var(--gold)", marginBottom: 8 }} />
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--w2)" }}>
                    {T(
                      "The Borivon team opens this event. Contact us if it concerns you.",
                      "Diesen Termin schaltet das Borivon-Team frei. Melden Sie sich bei uns, wenn er Sie betrifft.",
                      "Cet événement est ouvert par l'équipe Borivon. Contactez-nous s'il vous concerne.",
                    )}
                  </p>
                </div>
              ) : (
                <>
                  {detail.description && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--w2)", whiteSpace: "pre-wrap" }}>{detail.description}</p>}
                  {detail.link_url && (
                    <a href={detail.link_url} target="_blank" rel="noopener noreferrer" className="bvk-btn bvk-primary" style={{ width: "100%" }}>
                      <Video size={15} /> {T("Join event", "Teilnehmen", "Rejoindre")}
                    </a>
                  )}

                  {/* Add to calendar — EVERY viewer. Remembers their last pick as
                      the default action; the pencil reopens the provider list. */}
                  <div ref={addCalRef} className="relative">
                    {calDefault ? (
                      <div style={{ display: "flex", alignItems: "stretch", height: 40, borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
                        <button type="button" onClick={() => addToCalendar(detail, calDefault)}
                          style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "none", border: 0, padding: "0 14px", fontSize: 14, fontWeight: 500, color: "var(--w)", cursor: "pointer", fontFamily: "inherit" }}>
                          <CalendarPlus size={15} style={{ color: "var(--gold)", flexShrink: 0 }} />
                          {addToLabel(CAL_PROVIDER_LABEL(calDefault))}
                        </button>
                        <button type="button" onClick={() => setAddCalOpen((o) => !o)}
                          aria-label={T("Change calendar", "Kalender ändern", "Changer de calendrier")}
                          style={{ width: 46, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: 0, borderLeft: "1px solid var(--border)", color: "var(--w3)", cursor: "pointer" }}>
                          <Pencil size={13} />
                        </button>
                      </div>
                    ) : (
                      <Btn kind="ghost" onClick={() => setAddCalOpen((o) => !o)} style={{ width: "100%" }}>
                        <CalendarPlus size={15} style={{ color: "var(--gold)" }} />
                        {T("Add to calendar", "Zum Kalender hinzufügen", "Ajouter au calendrier")}
                        <ChevronDown size={14} style={{ opacity: 0.6 }} />
                      </Btn>
                    )}
                    <DropdownMenu open={addCalOpen} onClose={() => setAddCalOpen(false)} anchor={addCalRef.current}
                      above align="left" minWidth={addCalRef.current?.offsetWidth ?? 240}>
                      {CAL_OPTIONS.map((opt, i) => (
                        <button key={opt.key} type="button"
                          onClick={() => { addToCalendar(detail, opt.key); chooseDefault(opt.key); setAddCalOpen(false); }}
                          className="bv-row-hover w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 text-[13px]"
                          style={{ color: "var(--w)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                          <CalendarPlus size={14} style={{ color: "var(--gold)" }} /> {opt.label}
                          {calDefault === opt.key && (
                            <span className="ml-auto" style={{ fontSize: 12, fontWeight: 600, color: "var(--w3)" }}>
                              {T("Default", "Standard", "Défaut")}
                            </span>
                          )}
                        </button>
                      ))}
                    </DropdownMenu>
                  </div>
                </>
              )}

              {canManage && (
                <div className="flex items-center gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <Btn kind="ghost" size="sm" onClick={() => openEdit(detail)} disabled={saving}>
                    <Pencil size={13} />{T("Edit", "Bearbeiten", "Modifier")}
                  </Btn>
                  <Btn kind="danger" size="sm" onClick={() => deleteEvent(detail.id)} disabled={saving}>
                    <Trash2 size={13} />{T("Delete event", "Termin löschen", "Supprimer l'événement")}
                  </Btn>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add event modal (admin) ─────────────────────────────────────────────── */}
      <Modal open={addOpen} onClose={closeAdd} size="lg" busy={saving}
        title={editingId
          ? T("Edit event", "Termin bearbeiten", "Modifier l'événement")
          : T("Add event", "Termin hinzufügen", "Ajouter un événement")}
        footer={<>
          <Btn kind="quiet" onClick={closeAdd} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
          <Btn kind="primary" onClick={saveEvent} disabled={saving || !draft.title.trim() || !draft.date || !draft.time}>
            {saving
              ? T("Saving…", "Speichern…", "Enregistrement…")
              : editingId ? T("Save changes", "Speichern", "Enregistrer") : T("Add event", "Hinzufügen", "Ajouter")}
          </Btn>
        </>}>
        <div className="p-5 flex flex-col gap-4">

          {/* Title + counter */}
          <Field label={T("Title", "Titel", "Titre")} req>
            <input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="bvk-input" placeholder={T("e.g. German conversation hour", "z. B. Deutsch-Konversationsstunde", "ex. Heure de conversation")} />
            <div style={{ textAlign: "right", fontSize: 11, color: "var(--w3)" }}>{draft.title.length}/80</div>
          </Field>

          {/* Date · Time · Duration · Timezone */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label={T("Date", "Datum", "Date")} req>
              <GermanDateInput value={draft.date} onChange={(iso) => setDraft({ ...draft, date: iso })} className="bvk-input" />
            </Field>
            <Field label={T("Time", "Uhrzeit", "Heure")} req>
              <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className="bvk-input" />
            </Field>
            <Field label={T("Duration", "Dauer", "Durée")}>
              <select value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })} className="bvk-input">
                {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
            </Field>
            <Field label={T("Time zone", "Zeitzone", "Fuseau")}>
              <input value="Casablanca" readOnly disabled className="bvk-input" style={{ opacity: 0.7, cursor: "not-allowed" }} />
            </Field>
          </div>

          {/* Recurring — new events only (editing can't re-expand into copies) */}
          {!editingId && (
          <div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: "var(--w)" }} />
              <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13.5, color: "var(--w2)" }}>
                <Repeat size={13} style={{ color: "var(--gold)" }} /> {T("Recurring event", "Wiederkehrender Termin", "Événement récurrent")}
              </span>
            </label>
            {draft.recurring && (
              <div className="mt-2.5 flex items-center flex-wrap gap-2" style={{ fontSize: 13.5, color: "var(--w2)" }}>
                {T("Repeat weekly for", "Wöchentlich wiederholen für", "Répéter chaque semaine pendant")}
                <input type="number" min={2} max={52} value={draft.weeks}
                  onChange={(e) => setDraft({ ...draft, weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })}
                  className="bvk-input" style={{ width: 72, textAlign: "center" }} />
                {T("weeks", "Wochen", "semaines")}
              </div>
            )}
          </div>
          )}

          {/* Location + link/place */}
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
            <Field label={T("Location", "Ort", "Lieu")}>
              <select value={draft.locationType} onChange={(e) => setDraft({ ...draft, locationType: e.target.value as "online" | "inperson" })} className="bvk-input">
                <option value="online">{T("Online", "Online", "En ligne")}</option>
                <option value="inperson">{T("In person", "Vor Ort", "En présentiel")}</option>
              </select>
            </Field>
            {draft.locationType === "online" ? (
              <Field label={T("Join link", "Teilnahme-Link", "Lien de participation")}>
                <input value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="bvk-input" placeholder="https://…  (Zoom, Meet…)" maxLength={500} />
              </Field>
            ) : (
              <Field label={T("Address / place", "Adresse / Ort", "Adresse / lieu")}>
                <input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} className="bvk-input" placeholder={T("e.g. Borivon, Meknès", "z. B. Borivon, Meknès", "ex. Borivon, Meknès")} maxLength={200} />
              </Field>
            )}
          </div>

          {/* Description + counter */}
          <Field label={T("Description", "Beschreibung", "Description")}>
            <textarea value={draft.description} maxLength={600} rows={3} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="bvk-input"
              placeholder={T("What's this event about?", "Worum geht es bei diesem Termin?", "De quoi parle cet événement ?")} />
            <div style={{ textAlign: "right", fontSize: 11, color: "var(--w3)" }}>{draft.description.length}/600</div>
          </Field>

          {/* Who can attend — tag specific people (candidate / sub-admin / org admin). */}
          <Field label={T("Who can attend", "Wer darf teilnehmen", "Qui peut participer")}>
            {draft.attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.attendees.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5"
                    style={{ padding: "4px 5px 4px 11px", borderRadius: 999, background: "var(--bg2)", color: "var(--w)", fontSize: 12.5, fontWeight: 500 }}>
                    {a.name}
                    <button type="button" aria-label="Remove"
                      onClick={() => setDraft((d) => ({ ...d, attendees: d.attendees.filter((x) => x.id !== a.id) }))}
                      style={{ width: 18, height: 18, borderRadius: "50%", border: 0, padding: 0, background: "var(--card)", color: "var(--w3)", fontSize: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <input ref={tagInputRef} value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} className="bvk-input"
              placeholder={T("Type a name to tag…", "Name eingeben zum Markieren…", "Tapez un nom à taguer…")} />
            {/* Floating result menu (battle-tested DropdownMenu, portaled above
                the modal) — pops ABOVE the input so it never covers the buttons. */}
            <DropdownMenu
              open={!!tagQuery.trim()}
              onClose={() => setTagQuery("")}
              anchor={tagInputRef.current}
              above
              align="left"
              minWidth={tagInputRef.current?.offsetWidth ?? 320}
            >
              {(() => {
                const q = tagQuery.trim().toLowerCase();
                const matches = people
                  .filter((p) => !draft.attendees.some((a) => a.id === p.id))
                  .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q))
                  .slice(0, 6);
                if (matches.length === 0) {
                  return <div className="px-3 py-3" style={{ fontSize: 12.5, color: "var(--w3)" }}>{peopleLoaded ? T("No match", "Kein Treffer", "Aucun résultat") : T("Loading people…", "Lädt…", "Chargement…")}</div>;
                }
                return (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {matches.map((p, i) => (
                      <button key={p.id} type="button"
                        onClick={() => { setDraft((d) => ({ ...d, attendees: [...d.attendees, { id: p.id, name: p.name }] })); setTagQuery(""); tagInputRef.current?.focus(); }}
                        className="bv-row-hover w-full text-left px-3 py-2.5 flex items-center gap-3"
                        style={{ background: "transparent", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                        {p.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.photo} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: 34, height: 34 }} />
                        ) : (
                          <span className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, background: "var(--bg2)", color: "var(--w2)", fontSize: 12, fontWeight: 600 }}>{personInitials(p.name)}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--w)" }}>{p.name}</span>
                          <span className="block truncate" style={{ fontSize: 12, color: "var(--w3)" }}>{p.email}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </DropdownMenu>
            <p style={{ margin: 0, fontSize: 12, color: "var(--w3)" }}>
              {draft.attendees.length === 0
                ? T("Leave empty = everyone sees this event.", "Leer = alle sehen diesen Termin.", "Vide = tout le monde voit l'événement.")
                : T("Only the tagged people (+ admins) will see this event.", "Nur markierte Personen (+ Admins) sehen diesen Termin.", "Seules les personnes taguées (+ admins) verront l'événement.")}
            </p>
          </Field>

        </div>
      </Modal>

      {/* ── Sync calendar modal (subscribe once → auto-updates everywhere) ─────── */}
      <Modal open={syncOpen} onClose={() => setSyncOpen(false)} size="sm"
        title={T("Sync with your calendar", "Mit deinem Kalender synchronisieren", "Synchroniser avec votre agenda")}>
        {(() => {
          const origin = typeof window !== "undefined" ? window.location.origin : "https://www.borivon.com";
          const host = typeof window !== "undefined" ? window.location.host : "www.borivon.com";
          const https = feedToken ? `${origin}/api/portal/calendar/feed/${feedToken}.ics` : "";
          const webcal = feedToken ? `webcal://${host}/api/portal/calendar/feed/${feedToken}.ics` : "";
          const rows = [
            { key: "outlook", label: "Outlook", href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent("Borivon")}`, blank: true },
            { key: "google", label: "Google Calendar", href: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcal)}`, blank: true },
            { key: "apple", label: "Apple Calendar", href: webcal, blank: false },
          ];
          const copy = async () => { try { await navigator.clipboard.writeText(https); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
          return (
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Instant Google sync (OAuth push) — the "best" option when configured. */}
              {googleSync.configured && (
                <div style={{ borderRadius: 12, padding: 14, background: "var(--bg2)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="flex items-center gap-2">
                    <CalendarCheck size={15} style={{ color: "var(--gold)" }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--w)" }}>
                      {T("Instant Google sync", "Sofort-Sync mit Google", "Sync Google instantané")}
                    </span>
                    <span className="ml-auto" style={{ fontSize: 12, fontWeight: 600, color: "var(--gold)" }}>
                      {T("Best", "Beste", "Mieux")}
                    </span>
                  </div>
                  {googleSync.connected ? (
                    <>
                      <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, lineHeight: 1.5, color: "var(--w2)" }}>
                        <Dot st="approved" size={7} />
                        <span>{T("Connected", "Verbunden", "Connecté")}{googleSync.email ? ` · ${googleSync.email}` : ""}. {T("New events appear in your Google Calendar instantly.", "Neue Termine erscheinen sofort in deinem Google Kalender.", "Les nouveaux événements apparaissent instantanément dans votre agenda Google.")}</span>
                      </p>
                      <div>
                        <Btn kind="danger" size="sm" onClick={disconnectGoogle} disabled={gBusy}>{T("Disconnect", "Trennen", "Déconnecter")}</Btn>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--w2)" }}>
                        {T("Link your Google account once — every event lands in your calendar the instant it's created.", "Verknüpfe dein Google-Konto einmal — jeder Termin landet sofort in deinem Kalender.", "Liez votre compte Google une fois — chaque événement arrive instantanément.")}
                      </p>
                      <div>
                        <Btn kind="primary" size="sm" onClick={connectGoogle} disabled={gBusy}>
                          <CalendarCheck size={14} />{gBusy ? T("Opening…", "Öffnet…", "Ouverture…") : T("Connect Google Calendar", "Google Kalender verbinden", "Connecter Google Agenda")}
                        </Btn>
                      </div>
                    </>
                  )}
                </div>
              )}
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--w2)" }}>
                {googleSync.configured && <span style={{ color: "var(--w3)" }}>{T("Or subscribe (works on any calendar). ", "Oder abonnieren (jeder Kalender). ", "Ou s'abonner (tout agenda). ")}</span>}
                {T("Subscribe once — every Borivon event you're invited to (and any change) then shows up in your calendar automatically.",
                   "Einmal abonnieren — jeder Borivon-Termin für dich (und jede Änderung) erscheint automatisch in deinem Kalender.",
                   "Abonnez-vous une fois — chaque événement Borivon auquel vous êtes invité (et toute modification) apparaît automatiquement dans votre agenda.")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((r) => (
                  <a key={r.key} href={r.href || undefined} {...(r.blank ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="bv-press"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", textDecoration: "none" }}>
                    <CalendarCheck size={15} style={{ color: "var(--gold)" }} />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</span>
                    <ExternalLink size={13} className="ml-auto" style={{ color: "var(--w3)" }} />
                  </a>
                ))}
              </div>
              <div className="bvk-field">
                <span>{T("Or paste this link into any calendar app", "Oder diesen Link in eine Kalender-App einfügen", "Ou collez ce lien dans une app d'agenda")}</span>
                <div className="flex items-center gap-2">
                  <input readOnly value={https} onFocus={(e) => e.currentTarget.select()} className="bvk-input" style={{ fontSize: 12, height: 36 }} />
                  <Btn kind="ghost" size="sm" onClick={copy}>
                    {copied ? T("Copied!", "Kopiert!", "Copié !") : T("Copy", "Kopieren", "Copier")}
                  </Btn>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "var(--w3)" }}>
                {T("Calendar apps refresh subscriptions on their own schedule — Apple usually within an hour, Google can take longer.",
                   "Kalender-Apps aktualisieren Abos nach eigenem Zeitplan — Apple meist binnen einer Stunde, Google kann länger dauern.",
                   "Les agendas actualisent les abonnements à leur rythme — Apple en général sous une heure, Google parfois plus.")}
              </p>
            </div>
          );
        })()}
      </Modal>
    </main>
  );
}

/** The month's events as rows: the date big in serif, the title, a source dot with the time — 8 per page on a laptop, 6 on a phone. */
function EventList({ items, onOpen, T, locale, fmtRange }: {
  items: Ev[]; onOpen: (e: Ev) => void;
  T: (en: string, de: string, fr: string) => string; locale: string; fmtRange: (e: Ev) => string;
}) {
  const { slice, page, pages, setPage } = usePaged(items, 8, 6);
  const monthShort = new Intl.DateTimeFormat(locale, { month: "short", timeZone: TZ });
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((e) => {
          const src = e.source ?? "portal";
          const at = new Date(e.starts_at);
          return (
            <button key={e.id} type="button" onClick={() => onOpen(e)}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minWidth: 0, textAlign: "left", padding: "7px 12px 7px 6px", borderRadius: 12,
                border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", cursor: "pointer", fontFamily: "inherit" }}>
              {/* Date */}
              <span style={{ width: 46, flex: "none", textAlign: "center" }}>
                <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1, color: "var(--w)" }}>{casaParts(at).d}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 11, lineHeight: "14px", color: "var(--w3)" }}>{monthShort.format(at)}</span>
              </span>
              {/* Body */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, lineHeight: "20px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, minWidth: 0, fontSize: 12.5, lineHeight: "18px", color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden" }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, flex: "none", borderRadius: 999, background: e.locked ? "var(--w3)" : SOURCE_DOT[src] }} />
                  <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{fmtRange(e)}</span>
                  {e.vip_only && (
                    <span className="inline-flex items-center gap-1" style={{ flex: "none", fontSize: 12, fontWeight: 600, color: "var(--w2)" }}>
                      <Crown size={11} style={{ color: "var(--gold)" }} /> VIP
                    </span>
                  )}
                  {e.location && <span className="inline-flex items-center gap-1 truncate"><MapPin size={12} style={{ flexShrink: 0 }} /> {e.location}</span>}
                  {e.link_url && <span className="inline-flex items-center gap-1" style={{ flex: "none" }}><Video size={12} /> {T("Online", "Online", "En ligne")}</span>}
                  {e.locked && <span className="inline-flex items-center gap-1 truncate"><Lock size={12} style={{ color: "var(--gold)", flexShrink: 0 }} /> {T("Unlock with VIP", "Mit VIP freischalten", "Débloquer avec VIP")}</span>}
                </span>
              </span>
              {/* Cover, small */}
              {e.image_url && (
                <span className="relative" style={{ width: 44, height: 44, flex: "none", borderRadius: 10, overflow: "hidden" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.image_url} alt="" className="w-full h-full object-cover" style={{ filter: e.locked ? "blur(3px) brightness(0.6)" : undefined }} />
                  {e.locked && <span className="absolute inset-0 flex items-center justify-center"><Lock size={14} style={{ color: "#fff" }} /></span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}

/** One day's events (the day panel), tinted by source like the grid chips — 6 per page, 5 on a phone. */
function DayEvents({ items, fmtRange, onOpen }: { items: Ev[]; fmtRange: (e: Ev) => string; onOpen: (e: Ev) => void }) {
  const { slice, page, pages, setPage } = usePaged(items, 6, 5);
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slice.map((e) => {
          const src = e.source ?? "portal";
          return (
            <button key={e.id} type="button" onClick={() => onOpen(e)}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minWidth: 0, textAlign: "left", padding: "10px 12px", borderRadius: 12, border: 0,
                background: e.locked ? "var(--bg2)" : SOURCE_TINT[src], cursor: "pointer", fontFamily: "inherit" }}>
              {e.locked
                ? <Lock size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                : <span aria-hidden="true" style={{ width: 7, height: 7, flex: "none", borderRadius: 999, background: SOURCE_DOT[src] }} />}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 12.5, color: "var(--w3)", fontVariantNumeric: "tabular-nums" }}>{fmtRange(e)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// Small labelled-field wrapper — the one design's field (components/fx/kit .bvk-field: 11px uppercase label above the input).
function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="bvk-field">
      <span>{label}{req && <span aria-hidden="true"> *</span>}</span>
      {children}
    </label>
  );
}
