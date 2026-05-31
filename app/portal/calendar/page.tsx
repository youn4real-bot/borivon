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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Modal, GoldButton, GhostButton } from "@/components/ui/Modal";
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Lock, Plus,
  Trash2, MapPin, Video, Clock, CalendarPlus, Crown,
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
  vip_only: boolean; locked: boolean;
};

type Draft = {
  title: string; description: string; date: string; start: string; end: string;
  location: string; link: string; image: string; vip: boolean;
};
const EMPTY_DRAFT: Draft = { title: "", description: "", date: "", start: "18:00", end: "20:00", location: "", link: "", image: "", vip: false };

export default function CalendarPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const locale = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";

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
  const [saving, setSaving] = useState(false);

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
    setCanManage(!!j.canManage);
  }, [authedFetch, router]);

  // Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
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
    setDraft({ ...EMPTY_DRAFT, date: ymd ?? casaYMD(now) });
    setAddOpen(true);
  };

  const saveEvent = async () => {
    const startsISO = draft.date && draft.start ? casaWallToISO(draft.date, draft.start) : null;
    if (!draft.title.trim() || !startsISO) return;
    const endsISO = draft.end ? casaWallToISO(draft.date, draft.end) : null;
    setSaving(true);
    try {
      const res = await authedFetch("/api/portal/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title, description: draft.description, starts_at: startsISO, ends_at: endsISO,
          location: draft.location, link_url: draft.link, image_url: draft.image, vip_only: draft.vip,
        }),
      });
      if (res.ok) { await load(); setAddOpen(false); setDraft(EMPTY_DRAFT); }
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
        <h1 className="bv-h1">{T("Calendar", "Kalender", "Calendrier")}</h1>
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
                </div>
                <button onClick={() => setDetail(null)} aria-label="Close" className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ color: "var(--w3)" }}>✕</button>
              </div>

              <div className="flex flex-col gap-2 text-[13px]" style={{ color: "var(--w2)" }}>
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} style={{ color: "var(--gold)" }} /> {fmtFullDate(detail.starts_at)}</span>
                <span className="inline-flex items-center gap-2"><Clock size={14} style={{ color: "var(--gold)" }} /> {fmtRange(detail)} · {T("Casablanca time", "Casablanca-Zeit", "Heure de Casablanca")}</span>
                {detail.location && <span className="inline-flex items-center gap-2"><MapPin size={14} style={{ color: "var(--gold)" }} /> {detail.location}</span>}
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
                </>
              )}

              {canManage && (
                <button onClick={() => deleteEvent(detail.id)} disabled={saving}
                  className="bv-press inline-flex items-center gap-1.5 text-[12.5px] font-medium self-start mt-1 disabled:opacity-50"
                  style={{ color: "var(--red, #ef4444)" }}>
                  <Trash2 size={14} /> {T("Delete event", "Termin löschen", "Supprimer l'événement")}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add event modal (admin) ───────────────────────────────────────────── */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="md" busy={saving}
        title={T("New event", "Neuer Termin", "Nouvel événement")}
        subtitle={T("Times are in Casablanca time", "Zeiten in Casablanca-Zeit", "Heures en heure de Casablanca")}
        footer={<>
          <GhostButton onClick={() => setAddOpen(false)} disabled={saving}>{T("Cancel", "Abbrechen", "Annuler")}</GhostButton>
          <GoldButton onClick={saveEvent} disabled={saving || !draft.title.trim() || !draft.date || !draft.start}>
            {saving ? T("Saving…", "Speichern…", "Enregistrement…") : T("Create", "Erstellen", "Créer")}
          </GoldButton>
        </>}>
        <div className="p-5 flex flex-col gap-3.5">
          <Field label={T("Title", "Titel", "Titre")} req>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="bv-input" placeholder={T("e.g. German conversation workshop", "z. B. Deutsch-Konversationsworkshop", "ex. Atelier de conversation")} maxLength={200} />
          </Field>
          <Field label={T("Description (optional)", "Beschreibung (optional)", "Description (optionnel)")}>
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="bv-input" rows={3} maxLength={4000} style={{ resize: "vertical" }}
              placeholder={T("What's this event about?", "Worum geht es bei diesem Termin?", "De quoi parle cet événement ?")} />
          </Field>
          <Field label={T("Date", "Datum", "Date")} req>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="bv-input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T("Start", "Beginn", "Début")} req>
              <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="bv-input" />
            </Field>
            <Field label={T("End", "Ende", "Fin")}>
              <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="bv-input" />
            </Field>
          </div>
          <Field label={T("Location (optional)", "Ort (optional)", "Lieu (optionnel)")}>
            <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} className="bv-input" placeholder={T("Meknès / Online", "Meknès / Online", "Meknès / En ligne")} maxLength={200} />
          </Field>
          <Field label={T("Join link (optional)", "Teilnahme-Link (optional)", "Lien (optionnel)")}>
            <input value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} className="bv-input" placeholder="https://…" maxLength={500} />
          </Field>
          <Field label={T("Cover image URL (optional)", "Titelbild-URL (optional)", "URL de l'image (optionnel)")}>
            <input value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} className="bv-input" placeholder="https://…" />
          </Field>
          <label className="flex items-center gap-2.5 cursor-pointer mt-0.5">
            <input type="checkbox" checked={draft.vip} onChange={(e) => setDraft({ ...draft, vip: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: "var(--gold)" }} />
            <span className="text-[13px] inline-flex items-center gap-1.5" style={{ color: "var(--w2)" }}>
              <Crown size={13} style={{ color: "var(--gold)" }} /> {T("Premium (VIP) only", "Nur Premium (VIP)", "Premium (VIP) uniquement")}
            </span>
          </label>
        </div>
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
