"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, ShieldAlert, RefreshCw } from "lucide-react";

type Row = { userId: string; name: string; type: string; expiry: string; daysUntil: number; status: "expired" | "critical" | "soon" | "ok" };

const STATUS = {
  expired:  { fg: "var(--danger)",  bg: "var(--danger-bg)",  bd: "var(--danger-border)" },
  critical: { fg: "var(--danger)",  bg: "var(--danger-bg)",  bd: "var(--danger-border)" },
  soon:     { fg: "var(--gold)",    bg: "var(--gdim)",       bd: "var(--border-gold)" },
  ok:       { fg: "var(--success)", bg: "var(--success-bg)", bd: "var(--success-border)" },
};

export default function ExpiryRadarPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load(tk: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/portal/admin/expiry-radar", { headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json().catch(() => ({}));
      setRows(j.rows ?? []);
    } catch { /* ignore */ }
    setBusy(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin") { router.replace("/portal"); return; }   // supreme-admin only (test phase)
      setToken(tk);
      await load(tk);
      setLoading(false);
    });
  }, [router]);

  if (loading) return <PageLoader />;

  const label = (s: Row["status"]) => s === "expired" ? T("Expired", "Abgelaufen", "Expiré") : s === "critical" ? T("Critical", "Kritisch", "Critique") : s === "soon" ? T("Soon", "Bald", "Bientôt") : T("OK", "OK", "OK");
  const daysText = (d: number) => d < 0 ? T(`expired ${-d}d ago`, `vor ${-d} Tagen abgelaufen`, `expiré il y a ${-d}j`) : T(`in ${d} days`, `in ${d} Tagen`, `dans ${d} jours`);

  const counts = { expired: rows.filter(r => r.status === "expired").length, critical: rows.filter(r => r.status === "critical").length, soon: rows.filter(r => r.status === "soon").length };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <button onClick={() => router.back()} className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1 mb-4" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} /> {T("Back", "Zurück", "Retour")}
      </button>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={20} style={{ color: "var(--gold)" }} />
          <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>{T("Document expiry radar", "Dokument-Ablauf-Radar", "Radar d'expiration")}</h1>
        </div>
        <button onClick={() => void load(token)} disabled={busy} className="bv-press inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-60" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> {T("Refresh", "Aktualisieren", "Actualiser")}
        </button>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: "var(--w3)" }}>
        {T("Passports expired or expiring within a year — an expired passport blocks the whole visa pipeline. From the OCR-captured expiry date.",
           "Reisepässe, die abgelaufen sind oder innerhalb eines Jahres ablaufen — ein abgelaufener Pass blockiert den gesamten Visumprozess. Aus dem per OCR erfassten Ablaufdatum.",
           "Passeports expirés ou expirant dans l'année — un passeport expiré bloque tout le processus de visa. D'après la date d'expiration extraite par OCR.")}
      </p>

      {/* count strip */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { k: "expired" as const, n: counts.expired },
          { k: "critical" as const, n: counts.critical },
          { k: "soon" as const, n: counts.soon },
        ].map(({ k, n }) => (
          <div key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: STATUS[k].bg, border: `1px solid ${STATUS[k].bd}` }}>
            <span className="text-[12px] font-bold" style={{ color: STATUS[k].fg }}>{n}</span>
            <span className="text-[10.5px]" style={{ color: STATUS[k].fg }}>{label(k)}</span>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl p-5 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="text-[13px] font-semibold" style={{ color: "var(--success)" }}>{T("All passports valid for over a year. ✅", "Alle Reisepässe über ein Jahr gültig. ✅", "Tous les passeports valides plus d'un an. ✅")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const c = STATUS[r.status];
            return (
              <div key={r.userId + r.type} className="flex items-center justify-between gap-3 rounded-xl p-3.5" style={{ background: "var(--card)", border: `1px solid ${c.bd}` }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{r.name}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>{T("Passport", "Reisepass", "Passeport")} · {T("expires", "läuft ab", "expire")} {r.expiry}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="inline-block text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded" style={{ color: c.fg, background: c.bg, border: `1px solid ${c.bd}` }}>{label(r.status)}</span>
                  <p className="text-[11px] mt-1 tabular-nums" style={{ color: c.fg }}>{daysText(r.daysUntil)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
