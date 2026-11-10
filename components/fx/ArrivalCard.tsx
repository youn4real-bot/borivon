"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

/** A slim card on the nurse's dashboard, shown once her arrival plan has a place (app/portal/ankunft). */
export function ArrivalCard() {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let off = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const tok = data.session?.access_token;
      if (!tok) return;
      const r = await fetch("/api/portal/arrival", { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (!off && j?.plz) setShow(true);
    });
    return () => { off = true; };
  }, []);
  if (!show) return null;
  return (
    <a href="/portal/ankunft" className="no-underline" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "0 0 26px", padding: "18px 20px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}>
      <span>
        <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 21, fontWeight: 500, color: "var(--w)" }}>{t.arrCardH}</span>
        <span style={{ display: "block", marginTop: 4, fontSize: 13.5, color: "var(--w2)" }}>{t.arrCardP}</span>
      </span>
      <span aria-hidden="true" style={{ color: "var(--gold)", fontSize: 20 }}>→</span>
    </a>
  );
}
