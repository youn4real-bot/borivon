"use client";
/**
 * Her first salary — "Gehalt", founder 2026-11-12 sample 3: three things so it arrives on time (bank account,
 * Steuer-ID, Krankenkasse), each one tap to tick, a short "Wie?" where it helps, and the payday when her
 * admins entered it. No amounts. Data: app/api/portal/salary.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

type Sal = { payday: string; ticks: { bank: boolean; taxid: boolean; health: boolean }; admin?: boolean };
type L = "de" | "en" | "fr";
const T3 = (l: L, de: string, fr: string, en: string) => (l === "de" ? de : l === "fr" ? fr : en);

function useSalary(userId?: string | null) {
  const [s, setS] = useState<Sal | null>(null);
  const call = useCallback(async (method: "GET" | "PUT", body?: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) return;
    const q = method === "GET" && userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const r = await fetch(`/api/portal/salary${q}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...(userId ? { userId } : {}), ...body }) : undefined,
    }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as Sal | null) : null;
    if (j) setS(j);
  }, [userId]);
  useEffect(() => { setS(null); void call("GET"); }, [call]);
  return { sal: s, save: (p: Record<string, unknown>) => call("PUT", p) };
}

export function SalaryView({ userId }: { userId?: string | null }) {
  const { lang } = useLang();
  const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as L;
  const { sal, save } = useSalary(userId);
  const [how, setHow] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [day, setDay] = useState("");
  if (!sal) return null;
  const rows: { k: keyof Sal["ticks"]; t: string; s: string; how: string }[] = [
    { k: "bank", t: T3(l, "Bankkonto eröffnet", "Compte bancaire ouvert", "Bank account opened"), s: T3(l, "IBAN an die Personalabteilung", "IBAN au service du personnel", "IBAN to HR"),
      how: T3(l, "Ein Girokonto bei einer Bank in Deutschland. Die IBAN geben Sie der Personalabteilung.", "Un compte courant dans une banque en Allemagne. Donnez l’IBAN au service du personnel.", "A current account at a bank in Germany. Give the IBAN to HR.") },
    { k: "taxid", t: T3(l, "Steuer-ID erhalten", "Numéro fiscal reçu", "Tax ID received"), s: T3(l, "kommt per Post nach der Anmeldung", "arrive par la poste après l’inscription", "arrives by post after you register"),
      how: T3(l, "Nach der Anmeldung Ihrer Wohnung schickt Ihnen das Finanzamt die Steuer-ID per Post. Geben Sie sie der Personalabteilung.", "Après l’inscription de votre logement, le Finanzamt vous envoie le numéro par la poste. Donnez-le au service du personnel.", "After you register your flat, the tax office posts you the ID. Give it to HR.") },
    { k: "health", t: T3(l, "Krankenkasse gewählt", "Caisse maladie choisie", "Health insurer chosen"), s: T3(l, "Mitgliedsbescheinigung an den Arbeitgeber", "Attestation d’affiliation à l’employeur", "Membership certificate to your employer"),
      how: T3(l, "Wählen Sie eine gesetzliche Krankenkasse. Die Mitgliedsbescheinigung geben Sie Ihrem Arbeitgeber.", "Choisissez une caisse maladie légale. Donnez l’attestation à votre employeur.", "Choose a statutory health insurer. Give the membership certificate to your employer.") },
  ];
  const payLine = sal.payday ? new Date(sal.payday + "T00:00:00Z").toLocaleDateString(l === "de" ? "de-DE" : l === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : "";
  return (
    <div style={{ textAlign: "left" }}>
      <div className="serif" style={{ fontSize: 26, lineHeight: 1.1 }}>{T3(l, "Gehalt", "Salaire", "Salary")}</div>
      <div style={{ color: "var(--w3)", fontSize: 13.5, margin: "4px 0 16px" }}>{T3(l, "Damit Ihr Gehalt pünktlich ankommt", "Pour que votre salaire arrive à temps", "So your salary arrives on time")}</div>
      {rows.map((r) => {
        const on = sal.ticks[r.k];
        return (
          <div key={r.k} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14 }}>
              <button type="button" onClick={() => void save({ ticks: { [r.k]: !on } })} aria-pressed={on} aria-label={r.t}
                style={{ width: 24, height: 24, borderRadius: "50%", flex: "none", cursor: "pointer", padding: 0, border: `1.5px solid ${on ? "#16a34a" : "var(--w3)"}`, background: on ? "#16a34a" : "transparent" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{r.t}</div>
                <div style={{ color: "var(--w3)", fontSize: 12.5, marginTop: 2 }}>{r.s}</div>
              </div>
              <button type="button" onClick={() => setHow(how === r.k ? null : r.k)} style={{ background: "none", border: 0, color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>{T3(l, "Wie?", "Comment ?", "How?")}</button>
            </div>
            {how === r.k && <div style={{ fontSize: 13, color: "var(--w2)", padding: "10px 16px 4px", lineHeight: 1.5 }}>{r.how}</div>}
          </div>
        );
      })}
      {payLine && <div style={{ marginTop: 16, textAlign: "center", fontSize: 13.5, color: "var(--w3)" }}>{T3(l, "Erstes Gehalt am", "Premier salaire le", "First salary on")} <b className="serif" style={{ fontWeight: 400, fontSize: 22, color: "var(--w)" }}>{payLine}</b></div>}
      {sal.admin && (edit ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ flex: 1, height: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: "0 12px", fontSize: 14, color: "var(--w)" }} />
          <button type="button" onClick={() => { void save({ payday: day }); setEdit(false); }} style={{ height: 42, padding: "0 18px", borderRadius: 999, border: 0, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{T3(l, "Speichern", "Enregistrer", "Save")}</button>
        </div>
      ) : (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button type="button" onClick={() => { setDay(sal.payday); setEdit(true); }} style={{ background: "none", border: 0, padding: 0, fontSize: 12.5, color: "var(--w3)", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
            {T3(l, "Zahltag eintragen", "Date de paie", "Set payday")}
          </button>
        </div>
      ))}
    </div>
  );
}
