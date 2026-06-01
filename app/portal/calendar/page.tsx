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
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Lock, Plus,
  Trash2, MapPin, Video, Clock, CalendarPlus, Crown, Repeat, Users, Pencil, ChevronDown, CalendarCheck, ExternalLink,
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
};

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
  const [events, setEvents] = useState<Ev[]>([]);
  const [canManage, setCanManage] = useState(false);
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

  // ── Auth'd fetch (fresh token, same stale-token guard as other pages) ───────
  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    let token = session?.access_token ?? "";
    const expMs = (session?.expires_at ?? 0) * 1000;
    if (!expMs || expMs - Date.now() < 60_000) {
      try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) token = r.session.access_token; } catch { /* keep token */ }
    }
    return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
  }, []);

  const load = useCallback(async () => {
    const res = await authedFetch("/api/portal/calendar");
    if (res.status === 401) { router.replace("/portal"); return; }
    const j = await res.json().catch(() => ({ events: [] }));
    setEvents((j.events ?? []) as Ev[]);
    // Never let a server hiccup turn OFF the admin "+" — OR it with the cache-seeded value.
    setCanManage((prev) => prev || !!j.canManage);
    if (j.feedToken) setFeedToken(j.feedToken as string);
  }, [authedFetch, router]);

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

  // Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      // Show the admin "+ Add event" button INSTANTLY from the cached role —
      // independent of the calendar fetch — so the supreme admin always gets it.
      if (cachedRole(session.user.id) === "admin") setCanManage(true);
      await load();
      if (!cancelled) setLoading(false);
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

  // ── Small pieces ──────────────────────────────────────────────────────────────
  const Toggle = (
    <div className="inline-flex p-0.5 rounded-full" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
      {([["month", CalendarDays, T("Grid", "Raster", "Grille")], ["list", List, T("List", "Liste", "Liste")]] as const).map(([v, Icon, label]) => (
        <button key={v} onClick={() => setView(v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
          style={view === v
            ? { background: "var(--gold)", color: "#131312" }
            : { background: "transparent", color: "var(--w3)" }}>
          <Icon size={14} strokeWidth={2} /> <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main id="bv-main" className="mx-auto px-4 sm:px-5 py-6 sm:py-10 bv-page-bottom" style={{ maxWidth: 1120 }}>
      {/* Header */}
      <div className="mb-5">
        <p className="bv-eyebrow">{T("Community", "Community", "Communauté")}</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="bv-btn bv-btn-ghost text-[12.5px] px-3 py-1.5">
            {T("Today", "Heute", "Aujourd'hui")}
          </button>
          <div className="flex items-center gap-1">
            <button onClick={goPrev} aria-label={T("Previous month", "Vorheriger Monat", "Mois précédent")}
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w2)" }}>
              <ChevronLeft size={17} strokeWidth={2} />
            </button>
            <button onClick={goNext} aria-label={T("Next month", "Nächster Monat", "Mois suivant")}
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--w2)" }}>
              <ChevronRight size={17} strokeWidth={2} />
            </button>
          </div>
          <span className="text-[16px] sm:text-[18px] font-semibold capitalize" style={{ color: "var(--w)" }}>{monthTitle}</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--w3)" }}>
            <Clock size={13} /> {clock} · {T("Casablanca time", "Casablanca-Zeit", "Heure de Casablanca")}
          </span>
          <button onClick={() => setSyncOpen(true)}
            className="bv-btn bv-btn-ghost text-[12.5px] px-3 py-1.5 inline-flex items-center gap-1.5"
            title={T("Sync with your calendar", "Mit deinem Kalender synchronisieren", "Synchroniser avec votre calendrier")}>
            <CalendarCheck size={14} /> <span className="hidden sm:inline">{T("Sync", "Sync", "Sync")}</span>
          </button>
          {Toggle}
          {canManage && (
            <button onClick={() => openAdd()} className="bv-glow-gold bv-press inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-gold-sm)" }}>
              <Plus size={15} strokeWidth={2.4} /> {T("Add event", "Termin", "Événement")}
            </button>
          )}
        </div>
      </div>

      {/* ── Month grid ────────────────────────────────────────────────────────── */}
      {view === "month" ? (
        <div className="bv-card overflow-hidden" style={{ padding: 0 }}>
          {/* Weekday header */}
          <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--border)" }}>
            {weekdayLabels.map((w, i) => (
              <div key={i} className="px-2 py-2.5 text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-center"
                style={{ color: "var(--w3)" }}>{w}</div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7">
            {grid.map((cell, i) => {
              const dayEvents = eventsByDay[cell.ymd] ?? [];
              const isToday = cell.ymd === todayYMD;
              const clickable = dayEvents.length > 0 || canManage;
              return (
                <button key={cell.ymd + i} disabled={!clickable}
                  onClick={() => { if (dayEvents.length) setDayPanel(cell.ymd); else if (canManage) openAdd(cell.ymd); }}
                  className="relative text-left p-1.5 sm:p-2 flex flex-col gap-1 transition-colors disabled:cursor-default"
                  style={{
                    minHeight: "clamp(74px, 13vw, 116px)",
                    borderRight: (i % 7 !== 6) ? "1px solid var(--border)" : undefined,
                    borderBottom: i < 35 ? "1px solid var(--border)" : undefined,
                    background: cell.inMonth ? "transparent" : "var(--bg2)",
                    opacity: cell.inMonth ? 1 : 0.55,
                  }}>
                  {/* Day number */}
                  <span className="inline-flex items-center justify-center text-[11.5px] sm:text-[12.5px] font-semibold self-end"
                    style={isToday
                      ? { width: 22, height: 22, borderRadius: 999, background: "var(--gold)", color: "#131312" }
                      : { color: cell.inMonth ? "var(--w2)" : "var(--w3)" }}>
                    {cell.day}
                  </span>
                  {/* Events: chips on desktop, dots on phones */}
                  <div className="flex flex-col gap-1 min-w-0">
                    {dayEvents.slice(0, 3).map((e) => (
                      <span key={e.id}
                        onClick={(ev) => { ev.stopPropagation(); setDetail(e); }}
                        className="hidden sm:flex items-center gap-1 px-1.5 py-1 rounded-[6px] text-[10.5px] font-medium truncate cursor-pointer"
                        style={{
                          background: e.locked ? "var(--bg2)" : "color-mix(in srgb, var(--gold) 16%, transparent)",
                          color: e.locked ? "var(--w3)" : "var(--gold)",
                          border: "1px solid color-mix(in srgb, var(--gold) 26%, transparent)",
                        }}>
                        {e.locked ? <Lock size={9} strokeWidth={2.4} className="flex-shrink-0" /> : <span className="flex-shrink-0" style={{ width: 5, height: 5, borderRadius: 999, background: "var(--gold)" }} />}
                        <span className="truncate">{fmtTime(e.starts_at)} {e.title}</span>
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="hidden sm:block text-[10px] font-medium pl-1" style={{ color: "var(--w3)" }}>
                        +{dayEvents.length - 3} {T("more", "mehr", "plus")}
                      </span>
                    )}
                    {/* Mobile dot row */}
                    {dayEvents.length > 0 && (
                      <span className="flex sm:hidden items-center gap-0.5 flex-wrap">
                        {dayEvents.slice(0, 4).map((e) => (
                          <span key={e.id} style={{ width: 5, height: 5, borderRadius: 999, background: e.locked ? "var(--w3)" : "var(--gold)" }} />
                        ))}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── List view ──────────────────────────────────────────────────────── */
        <div className="flex flex-col gap-3">
          {monthEvents.length === 0 ? (
            <div className="bv-card text-center py-16">
              <CalendarDays size={30} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--w3)" }} />
              <p className="text-[14px] font-medium" style={{ color: "var(--w2)" }}>
                {T("No events this month", "Keine Termine in diesem Monat", "Aucun événement ce mois-ci")}
              </p>
              {canManage && (
                <button onClick={() => openAdd()} className="bv-btn bv-btn-ghost mt-3 inline-flex">
                  <CalendarPlus size={15} /> {T("Add the first event", "Ersten Termin hinzufügen", "Ajouter le premier événement")}
                </button>
              )}
            </div>
          ) : monthEvents.map((e) => (
            <button key={e.id} onClick={() => setDetail(e)}
              className="bv-card bv-press flex items-stretch gap-0 overflow-hidden text-left p-0" style={{ borderRadius: "var(--r-xl)" }}>
              {/* Cover / date badge */}
              {e.image_url ? (
                <div className="relative flex-shrink-0" style={{ width: 132, minHeight: 104 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.image_url} alt="" className="w-full h-full object-cover" style={{ filter: e.locked ? "blur(3px) brightness(0.6)" : undefined }} />
                  {e.locked && <span className="absolute inset-0 flex items-center justify-center"><Lock size={20} style={{ color: "#fff" }} /></span>}
                </div>
              ) : (
                <div className="flex-shrink-0 flex flex-col items-center justify-center"
                  style={{ width: 92, background: "color-mix(in srgb, var(--gold) 12%, transparent)", borderRight: "1px solid var(--border)" }}>
                  <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--gold)" }}>
                    {new Intl.DateTimeFormat(locale, { month: "short", timeZone: TZ }).format(new Date(e.starts_at))}
                  </span>
                  <span className="text-[26px] font-bold leading-none" style={{ color: "var(--w)" }}>
                    {casaParts(new Date(e.starts_at)).d}
                  </span>
                </div>
              )}
              {/* Body */}
              <div className="flex-1 min-w-0 p-3.5 sm:p-4 flex flex-col justify-center gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--w3)" }}>
                    <Clock size={12} /> {fmtRange(e)}
                  </span>
                  {e.vip_only && (
                    <span className="bv-chip bv-chip-gold inline-flex items-center gap-1" style={{ fontSize: 10.5 }}>
                      <Crown size={10} /> VIP
                    </span>
                  )}
                </div>
                <p className="text-[14.5px] font-semibold truncate" style={{ color: "var(--w)" }}>{e.title}</p>
                <div className="flex items-center gap-3 text-[12px]" style={{ color: "var(--w3)" }}>
                  {e.location && <span className="inline-flex items-center gap-1 truncate"><MapPin size={12} /> {e.location}</span>}
                  {e.link_url && <span className="inline-flex items-center gap-1"><Video size={12} /> {T("Online", "Online", "En ligne")}</span>}
                  {e.locked && <span className="inline-flex items-center gap-1" style={{ color: "var(--gold)" }}><Lock size={12} /> {T("Unlock with VIP", "Mit VIP freischalten", "Débloquer avec VIP")}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Day panel modal (events on one day) ───────────────────────────────── */}
      <Modal open={!!dayPanel} onClose={() => setDayPanel(null)} size="sm"
        title={dayPanel ? fmtFullDate(`${dayPanel}T12:00:00Z`) : ""}>
        <div className="p-4 flex flex-col gap-2">
          {(dayPanel ? (eventsByDay[dayPanel] ?? []) : []).map((e) => (
            <button key={e.id} onClick={() => { setDayPanel(null); setDetail(e); }}
              className="bv-press text-left p-3 rounded-[12px] flex items-center gap-3"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <span className="flex-shrink-0 inline-flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 10, background: "color-mix(in srgb, var(--gold) 16%, transparent)" }}>
                {e.locked ? <Lock size={15} style={{ color: "var(--w3)" }} /> : <CalendarDays size={15} style={{ color: "var(--gold)" }} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold truncate" style={{ color: "var(--w)" }}>{e.title}</span>
                <span className="block text-[12px]" style={{ color: "var(--w3)" }}>{fmtRange(e)}</span>
              </span>
            </button>
          ))}
          {canManage && dayPanel && (
            <button onClick={() => { const d = dayPanel; setDayPanel(null); openAdd(d); }}
              className="bv-btn bv-btn-ghost mt-1 inline-flex justify-center">
              <Plus size={15} /> {T("Add event", "Termin hinzufügen", "Ajouter un événement")}
            </button>
          )}
        </div>
      </Modal>

      {/* ── Event detail modal ────────────────────────────────────────────────── */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="md" chromeless>
        {detail && (
          <div className="flex flex-col">
            {detail.image_url && (
              <div className="relative" style={{ maxHeight: 220, overflow: "hidden", borderRadius: "20px 20px 0 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={detail.image_url} alt="" className="w-full object-cover" style={{ maxHeight: 220, filter: detail.locked ? "blur(6px) brightness(0.55)" : undefined }} />
                {detail.locked && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1" style={{ color: "#fff" }}>
                    <Lock size={26} /> <span className="text-[12px] font-semibold">{T("VIP only", "Nur VIP", "VIP uniquement")}</span>
                  </span>
                )}
              </div>
            )}
            <div className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {detail.vip_only && (
                    <span className="bv-chip bv-chip-gold inline-flex items-center gap-1 mb-2" style={{ fontSize: 10.5 }}>
                      <Crown size={10} /> VIP
                    </span>
                  )}
                  <h2 className="text-[19px] font-bold leading-tight" style={{ color: "var(--w)" }}>{detail.title}</h2>
                  {/* Host is ALWAYS shown as the organisation "Borivon" — never the
                      individual admin who created it (identity-masking rule). */}
                  <p className="text-[12px] mt-1" style={{ color: "var(--w3)" }}>
                    {T("by", "von", "par")} <span style={{ color: "var(--gold)", fontWeight: 600 }}>Borivon</span>
                  </p>
                </div>
                <button onClick={() => setDetail(null)} aria-label="Close" className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: "var(--w3)" }}>✕</button>
              </div>

              <div className="flex flex-col gap-2 text-[13px]" style={{ color: "var(--w2)" }}>
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} style={{ color: "var(--gold)" }} /> {fmtFullDate(detail.starts_at)}</span>
                <span className="inline-flex items-center gap-2"><Clock size={14} style={{ color: "var(--gold)" }} /> {fmtRange(detail)} · {T("Casablanca time", "Casablanca-Zeit", "Heure de Casablanca")}</span>
                {detail.location && <span className="inline-flex items-center gap-2"><MapPin size={14} style={{ color: "var(--gold)" }} /> {detail.location}</span>}
                {canManage && detail.attendee_ids && detail.attendee_ids.length > 0 && (
                  <span className="inline-flex items-start gap-2">
                    <Users size={14} style={{ color: "var(--gold)", marginTop: 1 }} />
                    <span>{T("Tagged", "Markiert", "Tagués")}: {detail.attendee_ids.map((id) => people.find((p) => p.id === id)?.name || "—").join(", ")}</span>
                  </span>
                )}
              </div>

              {detail.locked ? (
                <div className="rounded-[14px] p-4 text-center" style={{ background: "color-mix(in srgb, var(--gold) 10%, transparent)", border: "1px solid var(--border-gold)" }}>
                  <Lock size={20} className="mx-auto mb-2" style={{ color: "var(--gold)" }} />
                  <p className="text-[13px] font-medium" style={{ color: "var(--w2)" }}>
                    {T("This event is for premium members.", "Dieser Termin ist für Premium-Mitglieder.", "Cet événement est réservé aux membres premium.")}
                  </p>
                  <button onClick={() => { setDetail(null); router.push("/portal/dashboard"); }}
                    className="bv-glow-gold bv-press inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2 mt-3"
                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)" }}>
                    <Crown size={14} /> {T("Unlock with VIP", "Mit VIP freischalten", "Débloquer avec VIP")}
                  </button>
                </div>
              ) : (
                <>
                  {detail.description && <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--w2)" }}>{detail.description}</p>}
                  {detail.link_url && (
                    <a href={detail.link_url} target="_blank" rel="noopener noreferrer"
                      className="bv-glow-gold bv-press inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-4 py-2.5"
                      style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)" }}>
                      <Video size={15} /> {T("Join event", "Teilnehmen", "Rejoindre")}
                    </a>
                  )}

                  {/* Add to calendar — EVERY viewer. Remembers their last pick as
                      the default action; the pencil reopens the provider list. */}
                  <div ref={addCalRef} className="relative">
                    {calDefault ? (
                      <div className="flex items-stretch overflow-hidden" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", background: "var(--bg2)" }}>
                        <button type="button" onClick={() => addToCalendar(detail, calDefault)}
                          className="bv-press flex-1 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-4 py-2.5"
                          style={{ color: "var(--w)" }}>
                          <CalendarPlus size={15} style={{ color: "var(--gold)" }} />
                          {addToLabel(CAL_PROVIDER_LABEL(calDefault))}
                        </button>
                        <button type="button" onClick={() => setAddCalOpen((o) => !o)}
                          aria-label={T("Change calendar", "Kalender ändern", "Changer de calendrier")}
                          className="bv-press inline-flex items-center justify-center px-3"
                          style={{ color: "var(--w3)", borderLeft: "1px solid var(--border)" }}>
                          <Pencil size={13} />
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setAddCalOpen((o) => !o)}
                        className="bv-press w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-4 py-2.5"
                        style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                        <CalendarPlus size={15} style={{ color: "var(--gold)" }} />
                        {T("Add to calendar", "Zum Kalender hinzufügen", "Ajouter au calendrier")}
                        <ChevronDown size={14} style={{ opacity: 0.6 }} />
                      </button>
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
                            <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
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
                <div className="flex items-center gap-4 mt-1 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <button onClick={() => openEdit(detail)} disabled={saving}
                    className="bv-press inline-flex items-center gap-1.5 text-[12.5px] font-semibold disabled:opacity-50"
                    style={{ color: "var(--gold)" }}>
                    <Pencil size={14} /> {T("Edit", "Bearbeiten", "Modifier")}
                  </button>
                  <button onClick={() => deleteEvent(detail.id)} disabled={saving}
                    className="bv-press inline-flex items-center gap-1.5 text-[12.5px] font-medium disabled:opacity-50"
                    style={{ color: "var(--red, #ef4444)" }}>
                    <Trash2 size={14} /> {T("Delete event", "Termin löschen", "Supprimer l'événement")}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add event modal (admin) — Skool-style ─────────────────────────────── */}
      <Modal open={addOpen} onClose={closeAdd} size="lg" busy={saving}
        title={editingId
          ? T("Edit event", "Termin bearbeiten", "Modifier l'événement")
          : T("Add event", "Termin hinzufügen", "Ajouter un événement")}
        footer={<>
          <GhostButton onClick={closeAdd} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={saveEvent} disabled={saving || !draft.title.trim() || !draft.date || !draft.time}>
            {saving
              ? T("Saving…", "Speichern…", "Enregistrement…")
              : editingId ? T("Save changes", "Speichern", "Enregistrer") : T("Add event", "Hinzufügen", "Ajouter")}
          </GoldButton>
        </>}>
        <div className="p-5 flex flex-col gap-4">

          {/* Title + counter */}
          <Field label={T("Title", "Titel", "Titre")} req>
            <input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="bv-input" placeholder={T("e.g. German conversation hour", "z. B. Deutsch-Konversationsstunde", "ex. Heure de conversation")} />
            <span className="block text-right text-[10.5px] mt-1" style={{ color: "var(--w3)" }}>{draft.title.length}/80</span>
          </Field>

          {/* Date · Time · Duration · Timezone */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label={T("Date", "Datum", "Date")} req>
              <GermanDateInput value={draft.date} onChange={(iso) => setDraft({ ...draft, date: iso })} className="bv-input" />
            </Field>
            <Field label={T("Time", "Uhrzeit", "Heure")} req>
              <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className="bv-input" />
            </Field>
            <Field label={T("Duration", "Dauer", "Durée")}>
              <select value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })} className="bv-input">
                {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
            </Field>
            <Field label={T("Time zone", "Zeitzone", "Fuseau")}>
              <input value="Casablanca" readOnly disabled className="bv-input" style={{ opacity: 0.7, cursor: "not-allowed" }} />
            </Field>
          </div>

          {/* Recurring — new events only (editing can't re-expand into copies) */}
          {!editingId && (
          <div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: "var(--gold)" }} />
              <span className="text-[13px] inline-flex items-center gap-1.5" style={{ color: "var(--w2)" }}>
                <Repeat size={13} style={{ color: "var(--gold)" }} /> {T("Recurring event", "Wiederkehrender Termin", "Événement récurrent")}
              </span>
            </label>
            {draft.recurring && (
              <div className="mt-2.5 flex items-center flex-wrap gap-2 text-[13px]" style={{ color: "var(--w2)" }}>
                {T("Repeat weekly for", "Wöchentlich wiederholen für", "Répéter chaque semaine pendant")}
                <input type="number" min={2} max={52} value={draft.weeks}
                  onChange={(e) => setDraft({ ...draft, weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })}
                  className="bv-input" style={{ width: 72, textAlign: "center" }} />
                {T("weeks", "Wochen", "semaines")}
              </div>
            )}
          </div>
          )}

          {/* Location + link/place */}
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
            <Field label={T("Location", "Ort", "Lieu")}>
              <select value={draft.locationType} onChange={(e) => setDraft({ ...draft, locationType: e.target.value as "online" | "inperson" })} className="bv-input">
                <option value="online">{T("Online", "Online", "En ligne")}</option>
                <option value="inperson">{T("In person", "Vor Ort", "En présentiel")}</option>
              </select>
            </Field>
            {draft.locationType === "online" ? (
              <Field label={T("Join link", "Teilnahme-Link", "Lien de participation")}>
                <input value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="bv-input" placeholder="https://…  (Zoom, Meet…)" maxLength={500} />
              </Field>
            ) : (
              <Field label={T("Address / place", "Adresse / Ort", "Adresse / lieu")}>
                <input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} className="bv-input" placeholder={T("e.g. Borivon, Meknès", "z. B. Borivon, Meknès", "ex. Borivon, Meknès")} maxLength={200} />
              </Field>
            )}
          </div>

          {/* Description + counter */}
          <Field label={T("Description", "Beschreibung", "Description")}>
            <textarea value={draft.description} maxLength={600} rows={3} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="bv-input" style={{ resize: "vertical" }}
              placeholder={T("What's this event about?", "Worum geht es bei diesem Termin?", "De quoi parle cet événement ?")} />
            <span className="block text-right text-[10.5px] mt-1" style={{ color: "var(--w3)" }}>{draft.description.length}/600</span>
          </Field>

          {/* Who can attend — tag specific people (candidate / sub-admin / org admin). */}
          <Field label={T("Who can attend", "Wer darf teilnehmen", "Qui peut participer")}>
            {draft.attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.attendees.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11.5px] font-medium"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {a.name}
                    <button type="button" aria-label="Remove"
                      onClick={() => setDraft((d) => ({ ...d, attendees: d.attendees.filter((x) => x.id !== a.id) }))}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px]" style={{ background: "rgba(0,0,0,0.15)" }}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <input ref={tagInputRef} value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} className="bv-input"
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
                  return <div className="px-3 py-3 text-[12px]" style={{ color: "var(--w3)" }}>{peopleLoaded ? T("No match", "Kein Treffer", "Aucun résultat") : T("Loading people…", "Lädt…", "Chargement…")}</div>;
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
                          <span className="rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-semibold" style={{ width: 34, height: 34, background: "var(--gdim)", color: "var(--gold)" }}>{personInitials(p.name)}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium truncate" style={{ color: "var(--w)" }}>{p.name}</span>
                          <span className="block text-[11.5px] truncate" style={{ color: "var(--w3)" }}>{p.email}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </DropdownMenu>
            <p className="text-[10.5px] mt-1.5" style={{ color: "var(--w3)" }}>
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
            <div className="p-5 flex flex-col gap-4">
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--w2)" }}>
                {T("Subscribe once — every Borivon event you're invited to (and any change) then shows up in your own calendar automatically.",
                   "Einmal abonnieren — jeder Borivon-Termin, zu dem du eingeladen bist (und jede Änderung), erscheint dann automatisch in deinem Kalender.",
                   "Abonnez-vous une fois — chaque événement Borivon auquel vous êtes invité (et toute modification) apparaît ensuite automatiquement dans votre agenda.")}
              </p>
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <a key={r.key} href={r.href || undefined} {...(r.blank ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="bv-press flex items-center gap-3 px-3.5 py-3 rounded-[12px]"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}>
                    <CalendarCheck size={16} style={{ color: "var(--gold)" }} />
                    <span className="text-[13.5px] font-semibold">{r.label}</span>
                    <ExternalLink size={13} className="ml-auto" style={{ color: "var(--w3)" }} />
                  </a>
                ))}
              </div>
              <div>
                <span className="bv-label">{T("Or paste this link into any calendar app", "Oder füge diesen Link in eine beliebige Kalender-App ein", "Ou collez ce lien dans n'importe quelle application d'agenda")}</span>
                <div className="flex items-center gap-2 mt-1">
                  <input readOnly value={https} onFocus={(e) => e.currentTarget.select()} className="bv-input" style={{ fontSize: 11 }} />
                  <button onClick={copy} className="bv-btn bv-btn-ghost px-3 py-2 text-[12px] whitespace-nowrap">
                    {copied ? T("Copied!", "Kopiert!", "Copié !") : T("Copy", "Kopieren", "Copier")}
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "var(--w3)" }}>
                {T("New events may take a little while to appear — calendar apps refresh subscriptions on their own schedule (Apple usually within an hour, Google can take longer).",
                   "Neue Termine können etwas dauern — Kalender-Apps aktualisieren Abos nach eigenem Zeitplan (Apple meist innerhalb einer Stunde, Google kann länger dauern).",
                   "Les nouveaux événements peuvent prendre un peu de temps — les applications actualisent les abonnements à leur propre rythme (Apple en général sous une heure, Google peut être plus long).")}
              </p>
            </div>
          );
        })()}
      </Modal>
    </main>
  );
}

// Small labelled-field wrapper (matches the registration form styling).
function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="bv-label">{label}{req && <span className="req">*</span>}</span>
      {children}
    </label>
  );
}
