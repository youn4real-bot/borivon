"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";

/**
 * SUPREME-ADMIN-ONLY toggle: grant/revoke a candidate's access to the live
 * classroom while it's in private testing. Self-fetching against
 * /api/portal/admin/classroom/tester.
 */
export function ClassroomTesterToggle({ userId, accessToken, lang }: { userId: string; accessToken: string; lang: "fr" | "en" | "de" }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [tester, setTester] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/portal/admin/classroom/tester?userId=${userId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const j = await r.json().catch(() => ({}));
        if (!cancelled) setTester(r.ok ? j.tester === true : false);
      } catch { if (!cancelled) setTester(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, accessToken]);

  async function toggle() {
    if (tester === null || busy) return;
    setBusy(true);
    const next = !tester;
    try {
      const r = await fetch("/api/portal/admin/classroom/tester", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId: userId, enabled: next }),
      });
      if (r.ok) setTester(next);
    } catch { /* ignore */ }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl p-4 mb-3 flex items-center justify-between gap-3" style={{ background: "var(--card)", border: `1px solid ${tester ? "var(--border-gold)" : "var(--border)"}` }}>
      <div className="flex items-start gap-2.5">
        <FlaskConical size={15} style={{ color: "var(--gold)", marginTop: 1, flexShrink: 0 }} />
        <div>
          <p className="text-[12.5px] font-bold" style={{ color: "var(--w)" }}>{T("Live-class test access", "Live-Kurs-Testzugang", "Accès test au cours")}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>{T("Private test: only allowlisted candidates can see / join the live classroom.", "Privater Test: nur freigeschaltete Kandidaten sehen/betreten das Live-Klassenzimmer.", "Test privé : seuls les candidats autorisés voient / rejoignent le cours en direct.")}</p>
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={tester === null || busy}
        role="switch"
        aria-checked={tester === true}
        className="relative inline-flex items-center rounded-full transition-colors disabled:opacity-50 flex-shrink-0"
        style={{ width: 44, height: 24, background: tester ? "var(--gold)" : "var(--bg2)", border: `1px solid ${tester ? "var(--gold)" : "var(--border)"}` }}
      >
        <span className="inline-block rounded-full transition-transform" style={{ width: 18, height: 18, background: tester ? "#131312" : "var(--w3)", transform: tester ? "translateX(22px)" : "translateX(2px)" }} />
      </button>
    </div>
  );
}
