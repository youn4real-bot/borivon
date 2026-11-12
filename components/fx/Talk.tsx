"use client";
/**
 * Her next job interview — "Gespräche", founder 2026-11-12 sample 3: one big countdown, the Einrichtung,
 * the day and time, one "Beitreten" button, three quiet prep ticks, how many talks / yeses so far.
 * Admins set the talk (date + time in German time, video link, Einrichtung). Data: app/api/portal/talk.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

export type Talk = { at: string; link: string; place: string; prep: { cam: boolean; q: boolean }; cv: boolean; held: number; yes: number; admin?: boolean };
type L = "de" | "en" | "fr";
const T3 = (l: L, de: string, fr: string, en: string) => (l === "de" ? de : l === "fr" ? fr : en);

export function useTalk(userId?: string | null) {
  const [talk, setTalk] = useState<Talk | null>(null);
  const call = useCallback(async (method: "GET" | "PUT", body?: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) return;
    const q = method === "GET" && userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const r = await fetch(`/api/portal/talk${q}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...(userId ? { userId } : {}), ...body }) : undefined,
    }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as Talk | null) : null;
    if (j) setTalk(j);
  }, [userId]);
  useEffect(() => { setTalk(null); void call("GET"); }, [call]);
  return { talk, save: (p: Record<string, unknown>) => call("PUT", p) };
}

/** days from today (her local date) to the talk's date; null if no talk */
export function talkDays(at: string): number | null {
  if (!at) return null;
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

function whenLine(at: string, l: L) {
  const [date, time] = at.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const loc = l === "de" ? "de-DE" : l === "fr" ? "fr-FR" : "en-GB";
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return `${day} · ${time} ${T3(l, "Uhr", "h", "")}`.trim() + ` · ${T3(l, "Video", "Vidéo", "Video")}`;
}

export function TalkView({ userId }: { userId?: string | null }) {
  const { lang } = useLang();
  const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as L;
  const { talk, save } = useTalk(userId);
  const [edit, setEdit] = useState(false);
  const [at, setAt] = useState("");
  const [link, setLink] = useState("");
  const [place, setPlace] = useState("");
  if (!talk) return null;
  const days = talkDays(talk.at);
  const upcoming = days !== null && days >= 0;
  const big = !upcoming ? null : days === 0 ? T3(l, "Heute", "Aujourd’hui", "Today") : days === 1 ? T3(l, "Morgen", "Demain", "Tomorrow") : null;
  const pill = (on: boolean, label: string, onTap?: () => void) => (
    <button key={label} type="button" onClick={onTap} disabled={!onTap} aria-pressed={on}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 999, background: "var(--card)", border: "1px solid var(--border)",
        fontSize: 13, color: "var(--w)", cursor: onTap ? "pointer" : "default", fontFamily: "inherit" }}>
      <i style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-block", border: `1.5px solid ${on ? "#16a34a" : "var(--w3)"}`, background: on ? "#16a34a" : "transparent" }} />{label}
    </button>
  );
  const openEdit = () => { setAt(talk.at); setLink(talk.link); setPlace(talk.place); setEdit(true); };
  const field: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: "0 12px", fontSize: 14, color: "var(--w)", fontFamily: "inherit" };

  if (edit && talk.admin) {
    return (
      <div className="bw-card" style={{ textAlign: "left", maxWidth: 420, margin: "0 auto" }}>
        <div className="serif" style={{ fontSize: 24, marginBottom: 14 }}>{T3(l, "Gespräch", "Entretien", "Interview")}</div>
        <label style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Wann (deutsche Zeit)", "Quand (heure allemande)", "When (German time)")}</label>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value.slice(0, 16))} style={{ ...field, margin: "6px 0 12px" }} />
        <label style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Einrichtung", "Établissement", "Facility")}</label>
        <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} style={{ ...field, margin: "6px 0 12px" }} />
        <label style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Video-Link", "Lien vidéo", "Video link")}</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" style={{ ...field, margin: "6px 0 16px" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setEdit(false)} style={{ flex: 1, height: 44, borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w2)", fontSize: 14, cursor: "pointer" }}>{T3(l, "Abbrechen", "Annuler", "Cancel")}</button>
          <button type="button" onClick={() => { void save({ at, link: link.trim(), place: place.trim() }); setEdit(false); }}
            style={{ flex: 1, height: 44, borderRadius: 999, border: 0, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{T3(l, "Speichern", "Enregistrer", "Save")}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
      <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Nächstes Gespräch", "Prochain entretien", "Next interview")}</div>
      {upcoming ? (
        <>
          {big
            ? <div className="serif" style={{ fontSize: 64, lineHeight: 1, margin: "12px 0 4px" }}>{big}</div>
            : <div className="serif" style={{ fontSize: 92, lineHeight: 1, margin: "10px 0 2px" }}>{days}<i style={{ fontSize: 26, color: "var(--w3)", marginLeft: 8 }}>{T3(l, "Tage", "jours", "days")}</i></div>}
          {talk.place && <div className="serif" style={{ fontSize: 26, lineHeight: 1.2, marginTop: 6 }}>{talk.place}</div>}
          <div style={{ fontSize: 14, color: "var(--w3)", marginTop: 4 }}>{whenLine(talk.at, l)}</div>
          {talk.link && (
            <a href={talk.link} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 220, height: 46, marginTop: 18, borderRadius: 999, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              {T3(l, "Beitreten", "Rejoindre", "Join")}
            </a>
          )}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
            {pill(talk.cv, T3(l, "Lebenslauf bereit", "CV prêt", "CV ready"))}
            {pill(talk.prep.cam, T3(l, "Kamera geprüft", "Caméra testée", "Camera checked"), () => void save({ prep: { cam: !talk.prep.cam } }))}
            {pill(talk.prep.q, T3(l, "3 Fragen geübt", "3 questions pratiquées", "3 questions practised"), () => void save({ prep: { q: !talk.prep.q } }))}
          </div>
        </>
      ) : (
        <div className="serif" style={{ fontSize: 26, color: "var(--w2)", margin: "14px 0 4px" }}>{T3(l, "Noch kein Termin", "Pas encore de date", "No date yet")}</div>
      )}
      {talk.held > 0 && (
        <div style={{ marginTop: 22, fontSize: 12.5, color: "var(--w3)" }}>
          <b style={{ fontWeight: 500, color: "var(--w2)" }}>{talk.held}</b> {T3(l, talk.held === 1 ? "Gespräch bisher" : "Gespräche bisher", "entretien(s) jusqu’ici", talk.held === 1 ? "interview so far" : "interviews so far")}
          {talk.yes > 0 && <> · <b style={{ fontWeight: 500, color: "var(--w2)" }}>{talk.yes}</b> {T3(l, talk.yes === 1 ? "Zusage" : "Zusagen", "oui", talk.yes === 1 ? "yes" : "yeses")}</>}
        </div>
      )}
      {talk.admin && (
        <button type="button" onClick={openEdit} style={{ marginTop: 18, background: "none", border: 0, padding: 0, fontSize: 12.5, color: "var(--w3)", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
          {upcoming ? T3(l, "Termin ändern", "Modifier", "Change") : T3(l, "Termin eintragen", "Ajouter une date", "Set a date")}
        </button>
      )}
    </div>
  );
}
