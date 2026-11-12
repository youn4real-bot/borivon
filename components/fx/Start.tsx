"use client";
/**
 * Her first working day — "Arbeitsstart", founder 2026-11-12 sample 1: the days left, big; the Einrichtung;
 * the day, hour and ward; one "Wegbeschreibung" button (the Einrichtung's address in maps); three quiet
 * "what to bring" ticks she sets herself. Admins set the hour and ward (the date is her board's
 * "Erster Arbeitstag" date). Data: app/api/portal/start.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { talkDays } from "./Talk";

type StartData = { date: string; time: string; ward: string; place: string; address: string; bring: { passport: boolean; contract: boolean; shoes: boolean }; admin?: boolean };
type L = "de" | "en" | "fr";
const T3 = (l: L, de: string, fr: string, en: string) => (l === "de" ? de : l === "fr" ? fr : en);

export function useStart(userId?: string | null) {
  const [s, setS] = useState<StartData | null>(null);
  const call = useCallback(async (method: "GET" | "PUT", body?: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) return;
    const q = method === "GET" && userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const r = await fetch(`/api/portal/start${q}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...(userId ? { userId } : {}), ...body }) : undefined,
    }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as StartData | null) : null;
    if (j) setS(j);
  }, [userId]);
  useEffect(() => { setS(null); void call("GET"); }, [call]);
  return { start: s, save: (p: Record<string, unknown>) => call("PUT", p) };
}

export function StartView({ userId }: { userId?: string | null }) {
  const { lang } = useLang();
  const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as L;
  const { start: s, save } = useStart(userId);
  const [edit, setEdit] = useState(false);
  const [time, setTime] = useState("");
  const [ward, setWard] = useState("");
  if (!s) return null;
  const days = s.date ? talkDays(s.date + "T00:00") : null;
  const upcoming = days !== null && days >= 0;
  const loc = l === "de" ? "de-DE" : l === "fr" ? "fr-FR" : "en-GB";
  const dayLine = s.date ? new Date(s.date + "T00:00:00Z").toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const line = [dayLine, s.time ? `${s.time} ${T3(l, "Uhr", "h", "")}`.trim() : "", s.ward].filter(Boolean).join(" · ");
  const field: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: "0 12px", fontSize: 14, color: "var(--w)", fontFamily: "inherit" };
  const pill = (on: boolean, label: string, onTap: () => void) => (
    <button key={label} type="button" onClick={onTap} aria-pressed={on}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 999, background: "var(--card)", border: "1px solid var(--border)", fontSize: 13, color: "var(--w)", cursor: "pointer", fontFamily: "inherit" }}>
      <i style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-block", border: `1.5px solid ${on ? "#16a34a" : "var(--w3)"}`, background: on ? "#16a34a" : "transparent" }} />{label}
    </button>
  );

  if (edit && s.admin) {
    return (
      <div style={{ textAlign: "left", maxWidth: 420, margin: "0 auto" }}>
        <div className="serif" style={{ fontSize: 24, marginBottom: 14 }}>{T3(l, "Arbeitsstart", "Premier jour", "First day")}</div>
        <label style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Beginn", "Heure", "Starts at")}</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value.slice(0, 5))} style={{ ...field, margin: "6px 0 12px" }} />
        <label style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Station", "Service", "Ward")}</label>
        <input value={ward} onChange={(e) => setWard(e.target.value)} maxLength={80} placeholder={T3(l, "z. B. Station 4B, Innere Medizin", "ex. Service 4B", "e.g. Ward 4B")} style={{ ...field, margin: "6px 0 16px" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setEdit(false)} style={{ flex: 1, height: 44, borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w2)", fontSize: 14, cursor: "pointer" }}>{T3(l, "Abbrechen", "Annuler", "Cancel")}</button>
          <button type="button" onClick={() => { void save({ time, ward: ward.trim() }); setEdit(false); }}
            style={{ flex: 1, height: 44, borderRadius: 999, border: 0, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{T3(l, "Speichern", "Enregistrer", "Save")}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
      <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--w3)" }}>{T3(l, "Erster Arbeitstag", "Premier jour de travail", "First working day")}</div>
      {upcoming ? (
        <>
          {days === 0 || days === 1
            ? <div className="serif" style={{ fontSize: 64, lineHeight: 1, margin: "12px 0 4px" }}>{days === 0 ? T3(l, "Heute", "Aujourd’hui", "Today") : T3(l, "Morgen", "Demain", "Tomorrow")}</div>
            : <div className="serif" style={{ fontSize: 92, lineHeight: 1, margin: "10px 0 2px" }}>{days}<i style={{ fontSize: 26, color: "var(--w3)", marginLeft: 8 }}>{T3(l, "Tage", "jours", "days")}</i></div>}
          {s.place && <div className="serif" style={{ fontSize: 26, lineHeight: 1.2, marginTop: 6 }}>{s.place}</div>}
          {line && <div style={{ fontSize: 14, color: "var(--w3)", marginTop: 4 }}>{line}</div>}
          {s.address && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.place}, ${s.address}`)}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 220, height: 46, marginTop: 18, borderRadius: 999, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              {T3(l, "Wegbeschreibung", "Itinéraire", "Directions")}
            </a>
          )}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
            {pill(s.bring.passport, T3(l, "Reisepass", "Passeport", "Passport"), () => void save({ bring: { passport: !s.bring.passport } }))}
            {pill(s.bring.contract, T3(l, "Arbeitsvertrag", "Contrat de travail", "Work contract"), () => void save({ bring: { contract: !s.bring.contract } }))}
            {pill(s.bring.shoes, T3(l, "Bequeme Schuhe", "Chaussures confortables", "Comfortable shoes"), () => void save({ bring: { shoes: !s.bring.shoes } }))}
          </div>
        </>
      ) : (
        <div className="serif" style={{ fontSize: 26, color: "var(--w2)", margin: "14px 0 4px" }}>{T3(l, "Noch kein Datum", "Pas encore de date", "No date yet")}</div>
      )}
      {s.admin && (
        <button type="button" onClick={() => { setTime(s.time); setWard(s.ward); setEdit(true); }}
          style={{ marginTop: 18, background: "none", border: 0, padding: 0, fontSize: 12.5, color: "var(--w3)", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
          {T3(l, "Uhrzeit & Station", "Heure & service", "Time & ward")}
        </button>
      )}
    </div>
  );
}
