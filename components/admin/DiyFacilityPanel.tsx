"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangContext";

type Facility = {
  diy: true; name: string; nurseLink: string; teamLink: string | null; borivonAccess: boolean;
  usage: { nurses: number; users: number }; limits: { nurses: number; users: number };
};

/**
 * The DIY facility's own panel on top of /portal/admin (founder 2026-11-10): the facility runs its
 * space itself. Two links (its nurses, its team) and one switch: "Mit Borivon arbeiten".
 * Renders nothing for anyone who is not a DIY facility admin.
 */
export function DiyFacilityPanel({ accessToken, onDiy }: { accessToken: string; onDiy?: (diy: boolean) => void }) {
  const { t } = useLang();
  const [f, setF] = useState<Facility | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let off = false;
    fetch("/api/portal/org/facility", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (off) return; const ok = !!j?.diy; onDiy?.(ok); setF(ok ? (j as Facility) : null); })
      .catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  if (!f) return null;

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 2200); } catch { /* the link is visible */ }
  }
  async function toggle() {
    if (busy || !f) return;
    setBusy(true);
    const next = !f.borivonAccess;
    const r = await fetch("/api/portal/org/facility", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ borivonAccess: next }),
    }).catch(() => null);
    if (r?.ok) setF({ ...f, borivonAccess: next });
    setBusy(false);
  }

  const nursesFull = f.usage.nurses >= f.limits.nurses;
  const teamFull = f.usage.users >= f.limits.users;
  const line = "1px solid var(--border)";
  const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "10px 14px", borderRadius: 4, fontSize: 13.5, fontWeight: 500, cursor: "pointer" };
  const ink: React.CSSProperties = { ...btn, background: "var(--w)", color: "var(--bg)", border: "1px solid var(--w)" };
  const ghost: React.CSSProperties = { ...btn, background: "transparent", color: "var(--w)", border: line, textDecoration: "none" };

  const LinkRow = ({ title, hint, url, full, fullText }: { title: string; hint: string; url: string; full: boolean; fullText: string }) => (
    <div style={{ padding: "18px 0", borderTop: line }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 500, color: "var(--w)" }}>{title}</div>
      <p style={{ margin: "6px 0 12px", fontSize: 13.5, lineHeight: 1.55, color: "var(--w2)" }}>{full ? fullText : hint}</p>
      {!full && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button type="button" style={ink} onClick={() => copy(url)}>{copied === url ? t.diyCopied : t.diyCopy}</button>
          <a style={ghost} href={`https://wa.me/?text=${encodeURIComponent(t.diyWaText.replace("{url}", url))}`} target="_blank" rel="noopener noreferrer">{t.diyWhatsapp}</a>
          <span style={{ fontSize: 12.5, color: "var(--w3)", wordBreak: "break-all" }}>{url.replace(/^https:\/\//, "")}</span>
        </div>
      )}
    </div>
  );

  return (
    <section aria-label={f.name} style={{ margin: "0 0 22px", padding: "22px 24px 6px", border: line, borderRadius: 6, background: "var(--card)" }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(1.5rem, 1.2rem + 1.2vw, 2.1rem)", fontWeight: 500, letterSpacing: "-0.02em", color: "var(--w)", marginBottom: 14 }}>{f.name}</div>
      <LinkRow title={t.diyNurses} hint={t.diyNursesHint} url={f.nurseLink} full={nursesFull} fullText={t.diyLimitNurses.replace("{n}", String(f.limits.nurses))} />
      {f.teamLink && <LinkRow title={t.diyTeam} hint={t.diyTeamHint} url={f.teamLink} full={teamFull} fullText={t.diyLimitUsers.replace("{n}", String(f.limits.users))} />}
      <div style={{ padding: "18px 0", borderTop: line, display: "flex", gap: 18, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 500, color: "var(--w)" }}>{t.diyBorivonH}</div>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--w2)" }}>{t.diyBorivonP}</p>
        </div>
        <button type="button" role="switch" aria-checked={f.borivonAccess} onClick={toggle} disabled={busy}
          style={{ ...(f.borivonAccess ? ink : ghost), minWidth: 74, justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
          {f.borivonAccess ? t.diyBorivonOn : t.diyBorivonOff}
        </button>
      </div>
    </section>
  );
}
