"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { RefreshCw } from "lucide-react";
import { PageHead, Btn, Card, Dot, Empty, Pager, usePaged, STATUS_TINT, type Status } from "@/components/fx/kit";

type Row = { userId: string; name: string; type: string; expiry: string; daysUntil: number; status: "expired" | "critical" | "soon" | "ok" };

// the one status palette (components/fx/kit): expired / critical = red, soon = orange, ok = green
const KIT_ST: Record<Row["status"], Status> = { expired: "rejected", critical: "rejected", soon: "pending", ok: "approved" };

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

  return <ExpiryView rows={rows} busy={busy} onRefresh={() => void load(token)} onBack={() => router.back()} T={T} label={label} daysText={daysText} counts={counts} />;
}

// the one design (founder 2026-11-13): serif head, quiet back, ghost refresh, colour = status, the list flips
function ExpiryView({ rows, busy, onRefresh, onBack, T, label, daysText, counts }: {
  rows: Row[]; busy: boolean; onRefresh: () => void; onBack: () => void;
  T: (en: string, de: string, fr: string) => string; label: (s: Row["status"]) => string; daysText: (d: number) => string;
  counts: { expired: number; critical: number; soon: number };
}) {
  const { slice, page, pages, setPage } = usePaged(rows, 8, 6);
  return (
    <div className="mx-auto w-full max-w-2xl px-4" style={{ paddingTop: 90, paddingBottom: 32 }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: onBack }}
        title={T("Passport expiry", "Reisepass-Ablauf", "Expiration des passeports")}
        sub={T("Expired or expiring within a year — an expired passport blocks the visa.", "Abgelaufen oder innerhalb eines Jahres — ein abgelaufener Pass blockiert das Visum.", "Expiré ou dans l’année — un passeport expiré bloque le visa.")}
        actions={<Btn kind="ghost" size="sm" onClick={onRefresh} disabled={busy}><RefreshCw size={13} className={busy ? "animate-spin" : ""} />{T("Refresh", "Aktualisieren", "Actualiser")}</Btn>} />

      {/* the counts, as three quiet coloured numbers */}
      <div style={{ display: "flex", gap: 18, marginBottom: 16 }}>
        {(["expired", "critical", "soon"] as const).map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w3)" }}>
            <Dot st={KIT_ST[k]} /><b className="serif" style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, color: "var(--w)" }}>{counts[k]}</b>{label(k)}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card><Empty>{T("All passports valid for over a year.", "Alle Reisepässe über ein Jahr gültig.", "Tous les passeports valides plus d’un an.")}</Empty></Card>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {slice.map((r) => (
              <div key={r.userId + r.type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: STATUS_TINT[KIT_ST[r.status]] }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 2 }}>{T("Passport", "Reisepass", "Passeport")} · {T("expires", "läuft ab", "expire")} {r.expiry}</div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--w)" }}>{label(r.status)}</div>
                  <div style={{ fontSize: 12, color: "var(--w3)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{daysText(r.daysUntil)}</div>
                </div>
              </div>
            ))}
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
